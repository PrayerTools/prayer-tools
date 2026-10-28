// My prayer: the person's subscriptions across sites. The list is read in
// person scope; each site's details (and every change) are read inside that
// site's org, one site at a time.
import type { H3Event } from 'h3'
import { withOrg, withPerson, type Tx } from '@prayertools/shared/db/scope'
import { hashToken } from '@prayertools/shared/tokens'
import { campaignStatus, defaultDuration, durationOptions, durationRule, pickCurrentCampaign } from '@prayertools/shared/setup'
import { primaryEmailOf, PURPOSE_SITE_UPDATES } from '@prayertools/shared/crm'
import { siteSettings, siteUrlFor } from '@prayertools/shared/site'
import { getLanguage } from '@prayertools/shared/languages'
import type { SubscriptionRow } from '@prayertools/shared/subscriptions'
import { loadCampaigns } from '@prayertools/shared/campaigns'
import type { MySiteView, MyView } from '../../shared/view'
import { useDb } from './db'
import { MY_COOKIE } from './cookies'
import { commitmentsOf, consentList } from './manage'

export const MY_SESSION_DAYS = 30
export const MY_TOKEN_MINUTES = 30

export async function mySession(event: H3Event): Promise<string | null> {
  const token = getCookie(event, MY_COOKIE)
  if (!token) return null
  const row = await useDb()
    .selectFrom('pt_my_session')
    .select('intercessor_id')
    .where('token_hash', '=', hashToken(token))
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', new Date())
    .executeTakeFirst()
  return row?.intercessor_id ?? null
}

export async function requireMySession(event: H3Event): Promise<string> {
  const id = await mySession(event)
  if (!id) throw createError({ statusCode: 401, statusMessage: 'Sign in again' })
  return id
}

export interface PersonSubscription {
  id: string
  org_id: string
}

export async function personSubscriptions(intercessorId: string): Promise<PersonSubscription[]> {
  return await withPerson(useDb(), intercessorId, async tx => await tx
    .selectFrom('pt_subscription')
    .select(['id', 'org_id'])
    .where('intercessor_id', '=', intercessorId)
    .where('anonymized_at', 'is', null)
    .orderBy('created_at', 'desc')
    .execute())
}

// Loads one of the person's subscriptions inside its site's org, re-checking
// that it belongs to them.
export async function ownedSubscription(tx: Tx, intercessorId: string, subscriptionId: string): Promise<SubscriptionRow> {
  const sub = await tx.selectFrom('pt_subscription').selectAll().where('id', '=', subscriptionId).where('intercessor_id', '=', intercessorId).executeTakeFirst()
  if (!sub) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return sub
}

export async function buildMyView(intercessorId: string | null): Promise<MyView> {
  if (!intercessorId) return { signedIn: false, sites: [] }
  const subs = await personSubscriptions(intercessorId)
  const sites: MySiteView[] = []
  for (const s of subs) {
    const org = await useDb().selectFrom('orgs').select(['slug', 'name', 'suspended_at']).where('id', '=', s.org_id).executeTakeFirst()
    if (!org || org.suspended_at) continue
    const view = await withOrg(useDb(), s.org_id, async (tx) => {
      const sub = await tx.selectFrom('pt_subscription').selectAll().where('id', '=', s.id).executeTakeFirst()
      const site = await tx.selectFrom('pt_site').select(['languages', 'default_language', 'settings', 'status']).executeTakeFirst()
      if (!sub || !site) return null
      const campaigns = await loadCampaigns(tx)
      const commitments = await commitmentsOf(tx, sub.id, campaigns)
      const totals = await tx.selectFrom('pt_person_total').selectAll().where('subscription_id', '=', sub.id).execute()
      const email = sub.contact_id ? await primaryEmailOf(tx, sub.contact_id) : null
      const consents = await consentList(tx, email?.channelId ?? null, sub.language, site.default_language)
      const settings = siteSettings(site.settings)
      const current = pickCurrentCampaign(campaigns)
      const currentIds = new Set<string>()
      if (current && current.state !== 'between') currentIds.add(current.campaign.id)
      for (const c of commitments) {
        const camp = campaigns.find(x => x.id === c.campaignId)
        if (camp && campaignStatus(camp) !== 'ended') currentIds.add(camp.id)
      }
      const pastIds = new Set<string>([...commitments.map(c => c.campaignId), ...totals.map(t => t.campaign_id)].filter(id => !currentIds.has(id)))
      return {
        orgId: s.org_id,
        subscriptionId: sub.id,
        name: org.name,
        url: await siteUrlFor(tx, s.org_id, org.slug),
        languages: site.languages.map(code => ({ code, native: getLanguage(code)?.native ?? code })),
        language: sub.language,
        timezone: sub.timezone,
        status: sub.status,
        siteUpdates: !!consents.find(c => c.key === PURPOSE_SITE_UPDATES)?.granted,
        customConsents: consents.filter(c => c.key !== PURPOSE_SITE_UPDATES),
        current: campaigns.filter(c => currentIds.has(c.id)).map(c => ({
          campaign: {
            id: c.id,
            name: c.name,
            state: (campaignStatus(c) === 'upcoming' ? 'upcoming' : 'active') as 'upcoming' | 'active',
            goal: c.goal,
            durationRule: durationRule(c.goal, c.track_time),
            durations: durationOptions(c),
            defaultDuration: defaultDuration(c, settings.default_duration_min)
          },
          commitments: commitments.filter(x => x.campaignId === c.id)
        })),
        past: campaigns.filter(c => pastIds.has(c.id)).map((c) => {
          const t = totals.find(x => x.campaign_id === c.id)
          return { id: c.id, name: c.name, prayers: t?.prayers ?? 0, minutes: Math.round(Number(t?.seconds ?? 0) / 60) }
        })
      } satisfies MySiteView
    })
    if (view) sites.push(view)
  }
  return { signedIn: true, sites }
}

// Runs `fn` inside the site's org for one of the signed-in person's subscriptions.
export async function withMySubscription<T>(event: H3Event, fn: (tx: Tx, sub: SubscriptionRow) => Promise<T>): Promise<T> {
  const intercessorId = await requireMySession(event)
  const org = getRouterParam(event, 'org')
  const subId = getRouterParam(event, 'sub')
  const uuid = /^[0-9a-f-]{36}$/i
  if (!org || !subId || !uuid.test(org) || !uuid.test(subId)) throw createError({ statusCode: 404 })
  return await withOrg(useDb(), org, async (tx) => {
    const sub = await ownedSubscription(tx, intercessorId, subId)
    return await fn(tx, sub)
  })
}
