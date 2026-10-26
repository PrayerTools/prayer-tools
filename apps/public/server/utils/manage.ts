// The subscriber's own data for the manage page and My prayer. Everything
// here runs inside the site's org.
import type { H3Event } from 'h3'
import { withOrg, type Tx } from '@prayertools/shared/db/scope'
import { campaignStatus, defaultDuration, durationOptions, durationRule, isSideCampaign, pickCurrentCampaign } from '@prayertools/shared/setup'
import { consentState, primaryEmailOf, PURPOSE_SITE_UPDATES, customPurpose } from '@prayertools/shared/crm'
import { textIn } from '@prayertools/shared/translatable'
import { personalToken, prayUrl } from '@prayertools/shared/links'
import { toIsoDate } from '@prayertools/shared/dates'
import type { CampaignRow, CommitmentRow, SubscriptionRow } from '@prayertools/shared/subscriptions'
import type { TranslatableText } from '@prayertools/shared/db/schema'
import type { CommitmentView, ManageCampaignView, ManageView } from '../../shared/view'
import { readManageCookie } from './cookies'
import { useDb } from './db'
import type { SiteContext } from './site-context'

// The subscription the manage cookie names, if its version is still current.
export async function managedSubscription(tx: Tx, event: H3Event, orgId: string): Promise<SubscriptionRow | null> {
  const c = readManageCookie(event, orgId)
  if (!c) return null
  const sub = await tx.selectFrom('pt_subscription').selectAll().where('id', '=', c.subscriptionId).executeTakeFirst()
  if (!sub || sub.manage_version !== c.version || sub.anonymized_at) return null
  return sub
}

export function commitmentView(row: CommitmentRow, campaign: CampaignRow | undefined): CommitmentView {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    campaignName: campaign?.name ?? '',
    campaignEnded: campaign ? campaignStatus(campaign) === 'ended' : true,
    kind: row.kind,
    frequency: row.frequency,
    daysOfWeek: (row.days_of_week ?? []).map(Number),
    time: row.time,
    timezone: row.timezone,
    durationMin: row.duration_min,
    dates: (row.dates ?? []).map(d => new Date(d).toISOString()),
    paused: row.paused,
    startsOn: toIsoDate(row.starts_on as unknown as string)!,
    endsOn: toIsoDate(row.ends_on as unknown as string | null)
  }
}

export async function consentList(tx: Tx, channelId: string | null, lang: string, fallback: string): Promise<{ key: string, label: string, granted: boolean }[]> {
  const state = channelId ? await consentState(tx, channelId) : {}
  const options = await tx.selectFrom('pt_consent_option').select(['key', 'label']).where('active', '=', true).orderBy('position').execute()
  return [
    { key: PURPOSE_SITE_UPDATES, label: '', granted: !!state[PURPOSE_SITE_UPDATES] },
    ...options.map(o => ({ key: customPurpose(o.key), label: textIn(o.label as TranslatableText, lang, fallback), granted: !!state[customPurpose(o.key)] }))
  ]
}

export async function commitmentsOf(tx: Tx, subscriptionId: string, campaigns: CampaignRow[]): Promise<CommitmentView[]> {
  const rows = await tx.selectFrom('pt_commitment').selectAll().where('subscription_id', '=', subscriptionId).orderBy('created_at').execute()
  const byId = new Map(campaigns.map(c => [c.id, c]))
  return rows.map(r => commitmentView(r, byId.get(r.campaign_id)))
}

// The campaigns the person has prayer times in, each with its times: open
// campaigns first (the main campaign, then side campaigns by start date), then
// ended ones. With no times anywhere, the site's open main campaign, so they
// can add one.
function manageCampaigns(campaigns: CampaignRow[], commitments: CommitmentView[], siteDefaultDuration: number): ManageCampaignView[] {
  const joined = new Set(commitments.map(c => c.campaignId))
  let shown = campaigns.filter(c => joined.has(c.id))
  if (!shown.length) {
    const current = pickCurrentCampaign(campaigns)
    if (current && current.state !== 'between') shown = [current.campaign]
  }
  const rank = (c: CampaignRow) => (campaignStatus(c) === 'ended' ? 2 : 0) + (isSideCampaign(c) ? 1 : 0)
  return shown
    .sort((a, b) => rank(a) - rank(b) || (a.start_date ?? '').localeCompare(b.start_date ?? ''))
    .map((c) => {
      const status = campaignStatus(c)
      return {
        id: c.id,
        name: c.name,
        state: status,
        personal: c.start_mode === 'join',
        durationRule: durationRule(c.goal, c.track_time),
        durations: durationOptions(c),
        defaultDuration: defaultDuration(c, siteDefaultDuration),
        commitments: commitments.filter(x => x.campaignId === c.id)
      }
    })
}

export async function manageView(tx: Tx, ctx: SiteContext, sub: SubscriptionRow, campaigns: CampaignRow[], siteDefaultDuration: number, lang: string, fallback: string): Promise<ManageView> {
  const contact = sub.contact_id ? await tx.selectFrom('crm_records').select(['name']).where('id', '=', sub.contact_id).executeTakeFirst() : null
  const email = sub.contact_id ? await primaryEmailOf(tx, sub.contact_id) : null
  return {
    subscriptionId: sub.id,
    name: contact?.name ?? '',
    email: email?.email ?? null,
    language: sub.language,
    timezone: sub.timezone,
    status: sub.status,
    verified: !!sub.verified_at,
    referralCode: sub.referral_code,
    campaigns: manageCampaigns(campaigns, await commitmentsOf(tx, sub.id, campaigns), siteDefaultDuration),
    consents: await consentList(tx, email?.channelId ?? null, lang, fallback),
    icsUrl: `${ctx.canonicalOrigin.replace(/^https?:/, 'webcal:')}/ics/${personalToken(ctx.orgId, sub.id)}.ics`,
    prayUrl: prayUrl(ctx.canonicalOrigin, null, null, lang === fallback ? null : lang, ctx.orgId, sub.id)
  }
}

// Runs `fn` for the subscription named by this site's manage cookie.
export async function withManaged<T>(event: H3Event, fn: (tx: Tx, sub: SubscriptionRow, ctx: SiteContext) => Promise<T>): Promise<T> {
  const ctx = event.context.site as SiteContext | undefined
  if (!ctx) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return await withOrg(useDb(), ctx.orgId, async (tx) => {
    const sub = await managedSubscription(tx, event, ctx.orgId)
    if (!sub) throw createError({ statusCode: 401, statusMessage: 'Open the link from your email again' })
    return await fn(tx, sub, ctx)
  })
}
