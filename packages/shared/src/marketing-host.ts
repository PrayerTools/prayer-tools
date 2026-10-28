// prayer.tools' implementation of the marketing layer's host contract
// (`MarketingHost` in apps/admin/apps/marketing/lib/types.ts): audiences from
// campaigns and consent options, site branding and sender, global suppression,
// consent through the CRM helpers, and the marketing mail stream. The admin
// app registers it at boot; the worker passes it to `processMarketing`.
import { sql } from 'kysely'
import { platformConfig } from './config'
import { customPurpose, PURPOSE_SITE_UPDATES, setConsent } from './crm'
import type { PtCampaignTable, TiptapDoc } from './db/schema'
import type { Tx } from './db/scope'
import { suppressedAmong } from './email/suppression'
import { layout, loadSiteMailContext, type SiteMailContext } from './email/templates'
import { sendMail } from './email/transport'
import { emailT } from './i18n/email'
import { getLanguage } from './languages'
import { toIsoDate } from './dates'
import { campaignStatus, pickCurrentCampaign } from './setup'
import { loadCampaigns } from './campaigns'
import { PT_LIBRARY_APP } from './site'
import { tiptapToHtml, tiptapToText } from './tiptap'
import { textIn } from './translatable'
import type { Selectable } from 'kysely'

type Campaign = Selectable<PtCampaignTable>

interface Member {
  contactId: string | null
  channelId: string
  address: string
  language: string
  joinedAt: Date
  firstName: string | null
}

interface Recipient {
  firstName?: string | null
}

const REASON: Record<string, string> = {
  en: 'You are receiving this because you agreed to receive emails from {site}.',
  es: 'Recibes este correo porque aceptaste recibir correos de {site}.',
  fr: 'Vous recevez ce message parce que vous avez accepté de recevoir des e-mails de {site}.',
  pt: 'Você está recebendo isto porque aceitou receber e-mails de {site}.',
  ar: 'تصلك هذه الرسالة لأنك وافقت على تلقي رسائل من {site}.'
}

// `{first_name}` when the person gave no name.
const FRIEND: Record<string, string> = { en: 'friend', es: 'amigo', fr: 'ami', pt: 'amigo', ar: 'صديقي' }

export const MARKETING_AUDIENCES = {
  current: 'current_campaign',
  past: 'past_campaigns',
  consented: 'consented_updates'
} as const

// One campaign's people, by campaign id: `campaign:<uuid>`.
export const CAMPAIGN_AUDIENCE_PREFIX = 'campaign:'

interface SiteInfo {
  mail: SiteMailContext
  languages: string[]
  defaultLanguage: string
  campaigns: Campaign[]
  current: Campaign | null
  ended: Campaign[]
  lastEnded: Campaign | null
}

// Per-transaction memo: a send renders many recipients of one site in one
// transaction, and the site's context is the same for all of them.
const memo = new WeakMap<object, Map<string, Promise<unknown>>>()
function once<T>(tx: object, key: string, fn: () => Promise<T>): Promise<T> {
  let m = memo.get(tx)
  if (!m) memo.set(tx, (m = new Map()))
  if (!m.has(key)) m.set(key, fn())
  return m.get(key) as Promise<T>
}

function siteInfo(tx: Tx, orgId: string): Promise<SiteInfo> {
  return once(tx, `site:${orgId}`, async () => {
    const mail = await loadSiteMailContext(tx, orgId)
    const site = await tx.selectFrom('pt_site').select(['languages', 'default_language']).where('org_id', '=', orgId).executeTakeFirstOrThrow()
    const campaigns = await loadCampaigns(tx, { orgId })
    const now = new Date()
    const ended = campaigns.filter(c => campaignStatus(c, now) === 'ended')
    return {
      mail,
      languages: site.languages,
      defaultLanguage: site.default_language,
      campaigns,
      current: pickCurrentCampaign(campaigns, now)?.campaign ?? null,
      ended,
      lastEnded: pickCurrentCampaign(ended, now)?.campaign ?? null
    }
  })
}

function firstNameOf(name: string | null | undefined, address: string): string | null {
  const n = (name ?? '').trim()
  if (!n || n === address.split('@')[0] || n === 'Anonymized') return null
  return n.split(/\s+/)[0]!.slice(0, 60)
}

function members(tx: Tx, orgId: string) {
  return tx
    .selectFrom('pt_subscription as s')
    .innerJoin('crm_records as r', 'r.id', 's.contact_id')
    .innerJoin('crm_contact_channels as cc', 'cc.record_id', 'r.id')
    .innerJoin('crm_channels as ch', 'ch.id', 'cc.channel_id')
    .select(['r.id as contactId', 'ch.id as channelId', 'ch.value as address', 's.language as language', 's.created_at as joinedAt', 'r.name as name'])
    .where('s.org_id', '=', orgId)
    .where('ch.channel_type', '=', 'email')
    .where('ch.verified', '=', true)
    .where('s.anonymized_at', 'is', null)
}

async function campaignMembers(tx: Tx, orgId: string, campaignIds: string[]): Promise<Member[]> {
  if (!campaignIds.length) return []
  const rows = await members(tx, orgId)
    .where(eb => eb.exists(eb.selectFrom('pt_commitment as c').select('c.id').whereRef('c.subscription_id', '=', 's.id').where('c.campaign_id', 'in', campaignIds)))
    .execute()
  return rows.map(r => ({ contactId: r.contactId, channelId: r.channelId, address: r.address, language: r.language, joinedAt: new Date(r.joinedAt), firstName: firstNameOf(r.name, r.address) }))
}

async function consentMembers(tx: Tx, orgId: string, purpose: string, defaultLanguage: string): Promise<Member[]> {
  const rows = await tx
    .selectFrom('crm_channel_consents as k')
    .innerJoin('crm_channels as ch', 'ch.id', 'k.channel_id')
    .innerJoin('crm_contact_channels as cc', 'cc.channel_id', 'ch.id')
    .innerJoin('crm_records as r', 'r.id', 'cc.record_id')
    .leftJoin('pt_subscription as s', 's.contact_id', 'r.id')
    .select(['r.id as contactId', 'ch.id as channelId', 'ch.value as address', 's.language as language', 's.created_at as subCreated', 'r.created_at as contactCreated', 'r.name as name'])
    .where('k.org_id', '=', orgId)
    .where('k.purpose', '=', purpose)
    .where('k.status', '=', 'opt_in')
    .where('ch.channel_type', '=', 'email')
    .where('ch.verified', '=', true)
    .where('r.record_type', '=', 'contacts')
    .where('s.anonymized_at', 'is', null)
    .execute()
  return rows.map(r => ({
    contactId: r.contactId,
    channelId: r.channelId,
    address: r.address,
    language: r.language ?? defaultLanguage,
    joinedAt: new Date(r.subCreated ?? r.contactCreated),
    firstName: firstNameOf(r.name, r.address)
  }))
}

export const ptMarketingHost = {
  personalAppId: PT_LIBRARY_APP,

  secret(): string {
    return platformConfig().secret
  },

  unsubscribeBaseUrl(): string {
    return platformConfig().adminUrl
  },

  async listAudiences(tx: Tx, orgId: string) {
    const info = await siteInfo(tx, orgId)
    const audiences: { key: string, label: string, description: string, purpose: string }[] = [
      {
        key: MARKETING_AUDIENCES.current,
        label: info.current ? `People in ${info.current.name}` : 'People in the current campaign',
        description: 'Everyone with prayer times in the site\'s current main campaign.',
        purpose: PURPOSE_SITE_UPDATES
      },
      {
        key: MARKETING_AUDIENCES.past,
        label: 'People from past campaigns',
        description: 'Everyone who prayed in a campaign that has ended — for a relaunch or re-engagement.',
        purpose: PURPOSE_SITE_UPDATES
      },
      {
        key: MARKETING_AUDIENCES.consented,
        label: 'Everyone who opted in to updates',
        description: 'Everyone who agreed to updates from this site, in any campaign.',
        purpose: PURPOSE_SITE_UPDATES
      }
    ]
    // Newest first: upcoming and running campaigns lead.
    const named = [...info.campaigns].sort((a, b) => (toIsoDate(b.start_date) ?? '').localeCompare(toIsoDate(a.start_date) ?? '') || +new Date(b.created_at) - +new Date(a.created_at))
    for (const c of named) {
      const status = campaignStatus({ ...c, start_date: toIsoDate(c.start_date), end_date: toIsoDate(c.end_date) })
      audiences.push({
        key: `${CAMPAIGN_AUDIENCE_PREFIX}${c.id}`,
        label: `People in ${c.name}`,
        description: `Everyone with prayer times in ${c.name} (${c.kind === 'side' ? 'side campaign, ' : ''}${status === 'ended' ? 'ended' : status === 'upcoming' ? 'upcoming' : 'running'}).`,
        purpose: PURPOSE_SITE_UPDATES
      })
    }
    const options = await tx.selectFrom('pt_consent_option').select(['key', 'label']).where('org_id', '=', orgId).where('active', '=', true).orderBy('position').execute()
    for (const o of options) {
      audiences.push({
        key: `custom:${o.key}`,
        label: textIn(o.label, info.defaultLanguage) || o.key,
        description: 'Everyone who ticked this consent option.',
        purpose: customPurpose(o.key)
      })
    }
    return audiences
  },

  async resolveAudience(tx: Tx, orgId: string, key: string): Promise<Member[]> {
    const info = await siteInfo(tx, orgId)
    if (key === MARKETING_AUDIENCES.current) return await campaignMembers(tx, orgId, info.current ? [info.current.id] : [])
    if (key === MARKETING_AUDIENCES.past) return await campaignMembers(tx, orgId, info.ended.map(c => c.id))
    if (key === MARKETING_AUDIENCES.consented) return await consentMembers(tx, orgId, PURPOSE_SITE_UPDATES, info.defaultLanguage)
    if (key.startsWith('custom:')) return await consentMembers(tx, orgId, key, info.defaultLanguage)
    if (key.startsWith(CAMPAIGN_AUDIENCE_PREFIX)) {
      const id = key.slice(CAMPAIGN_AUDIENCE_PREFIX.length)
      return await campaignMembers(tx, orgId, info.campaigns.some(c => c.id === id) ? [id] : [])
    }
    return []
  },

  async languages(tx: Tx, orgId: string) {
    const info = await siteInfo(tx, orgId)
    return {
      languages: info.languages.map((code) => {
        const l = getLanguage(code)
        return { code, label: l ? (l.native === l.name ? l.name : `${l.name} · ${l.native}`) : code, dir: l?.dir ?? 'ltr' as const }
      }),
      defaultLanguage: info.defaultLanguage
    }
  },

  variableList: [
    { key: 'first_name', label: 'First name' },
    { key: 'site_name', label: 'Site name' },
    { key: 'campaign_name', label: 'Campaign name' },
    { key: 'past_campaign', label: 'Past campaign' },
    { key: 'site_link', label: 'Site link' }
  ],

  async variables(tx: Tx, orgId: string, lang: string, recipient: Recipient | null): Promise<Record<string, string>> {
    const info = await siteInfo(tx, orgId)
    return {
      site_name: info.mail.siteName,
      campaign_name: info.current?.name ?? '',
      past_campaign: info.lastEnded?.name ?? '',
      site_link: info.mail.siteUrl,
      first_name: recipient?.firstName || FRIEND[lang] || FRIEND.en!
    }
  },

  async renderContent(tx: Tx, orgId: string, doc: TiptapDoc, opts: { lang: string, vars: Record<string, string> }) {
    const info = await siteInfo(tx, orgId)
    return {
      html: tiptapToHtml(doc, { mode: 'email', vars: opts.vars, color: info.mail.color }),
      text: tiptapToText(doc, opts.vars)
    }
  },

  async wrap(tx: Tx, orgId: string, lang: string, body: { html: string, text: string }, opts: { unsubscribeUrl: string | null, test: boolean }) {
    const info = await siteInfo(tx, orgId)
    const reason = (REASON[lang] ?? REASON.en!).replace('{site}', info.mail.siteName)
    const text = [body.text, '', '—', reason]
    if (opts.unsubscribeUrl) text.push(`${emailT(lang, 'footer.unsubscribe')}: ${opts.unsubscribeUrl}`)
    return {
      html: layout(info.mail, lang, body.html, { unsubscribeUrl: opts.unsubscribeUrl, reason }, { test: opts.test }),
      text: (opts.test ? `${emailT(lang, 'test.banner')}\n\n` : '') + text.join('\n')
    }
  },

  async sender(tx: Tx, orgId: string) {
    const { mail } = await siteInfo(tx, orgId)
    return { fromName: mail.fromName, fromLocal: mail.fromLocal, replyTo: mail.replyTo }
  },

  async suppressedAmong(tx: Tx, addresses: string[]): Promise<Set<string>> {
    return await suppressedAmong(tx, addresses)
  },

  async withdrawConsent(tx: Tx, channelId: string, purpose: string, capture: { source: string, surface: string, ip?: string | null, userAgent?: string | null }): Promise<boolean> {
    return await setConsent(tx, channelId, purpose, false, {
      wording: { key: 'marketing.unsubscribe' },
      surface: capture.surface,
      source: capture.source,
      ip: capture.ip ?? null,
      userAgent: capture.userAgent ?? null
    })
  },

  async send(mail: { to: string, fromName: string, fromLocal: string, replyTo: string | null, subject: string, html: string, text: string, unsubscribeUrl: string | null, meta: Record<string, string> }) {
    return await sendMail({ stream: 'marketing', ...mail, tags: ['marketing'] })
  },

  async complaintCount(tx: Tx, orgId: string, since: Date): Promise<number> {
    const row = await tx
      .selectFrom('pt_event')
      .select(eb => eb.fn.countAll<string>().as('n'))
      .where('org_id', '=', orgId)
      .where('type', '=', 'email_complaint')
      .where('created_at', '>=', since)
      .where(sql<boolean>`meta->>'stream' = 'marketing'`)
      .executeTakeFirstOrThrow()
    return Number(row.n)
  },

  throttlePerMinute(_orgId: string): number {
    return Number(process.env.MARKETING_THROTTLE_PER_MINUTE) || 300
  }
}
