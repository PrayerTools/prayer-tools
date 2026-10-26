// Helpers for the mobile app API: device credentials (Bearer, stored hashed),
// sites by slug, and the device's app subscription on a site.
import type { H3Event } from 'h3'
import { sql } from 'kysely'
import { withOrg, type Tx } from '@prayertools/shared/db/scope'
import { hashToken, shortCode } from '@prayertools/shared/tokens'
import { normalizeCampaign, type CampaignRow, type CommitmentRow, type SubscriptionRow } from '@prayertools/shared/subscriptions'
import { campaignStatus, defaultDuration, durationOptions, durationRule, isSideCampaign, slotMinutes } from '@prayertools/shared/setup'
import { toIsoDate } from '@prayertools/shared/dates'
import { useDb } from './db'

export interface Device {
  deviceId: string
  intercessorId: string
}

export async function requireDevice(event: H3Event): Promise<Device> {
  const auth = getRequestHeader(event, 'authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token || token.length > 200) throw createError({ statusCode: 401, statusMessage: 'Missing credential' })
  const row = await useDb().selectFrom('pt_intercessor_device').select(['id', 'intercessor_id', 'last_seen_at']).where('credential_hash', '=', hashToken(token)).executeTakeFirst()
  if (!row) throw createError({ statusCode: 401, statusMessage: 'Unknown credential' })
  if (Date.now() - new Date(row.last_seen_at).getTime() > 3_600_000) {
    await useDb().updateTable('pt_intercessor_device').set({ last_seen_at: new Date() }).where('id', '=', row.id).execute()
  }
  return { deviceId: row.id, intercessorId: row.intercessor_id }
}

export interface ApiSite {
  orgId: string
  slug: string
  name: string
}

const siteCache = new Map<string, { value: ApiSite | null, expires: number }>()

// Published (or archived) sites by slug; drafts never show in the API.
export async function apiSite(slug: string | undefined): Promise<ApiSite> {
  const key = (slug ?? '').toLowerCase()
  const hit = siteCache.get(key)
  let value: ApiSite | null
  if (hit && hit.expires > Date.now()) {
    value = hit.value
  } else {
    value = null
    const org = /^[a-z0-9-]{1,40}$/.test(key) ? await useDb().selectFrom('orgs').select(['id', 'slug', 'name', 'suspended_at']).where('slug', '=', key).executeTakeFirst() : null
    if (org && !org.suspended_at) {
      const status = await withOrg(useDb(), org.id, async tx => (await tx.selectFrom('pt_site').select('status').executeTakeFirst())?.status)
      if (status && status !== 'draft') value = { orgId: org.id, slug: org.slug, name: org.name }
    }
    siteCache.set(key, { value, expires: Date.now() + 15_000 })
  }
  if (!value) throw createError({ statusCode: 404, statusMessage: 'Site not found' })
  return value
}

export async function campaignsOf(tx: Tx): Promise<CampaignRow[]> {
  return (await tx.selectFrom('pt_campaign').selectAll().orderBy('start_date').execute()).map(normalizeCampaign) as CampaignRow[]
}

export async function appSubscription(tx: Tx, intercessorId: string): Promise<SubscriptionRow | null> {
  return await tx.selectFrom('pt_subscription').selectAll().where('intercessor_id', '=', intercessorId).where('delivery', '=', 'app').executeTakeFirst() ?? null
}

// Creates the device's app subscription on the site on first use.
export async function ensureAppSubscription(tx: Tx, intercessorId: string, opts: { language?: string | null, timezone?: string | null, referral?: string | null }): Promise<SubscriptionRow> {
  const existing = await appSubscription(tx, intercessorId)
  if (existing) return existing
  const site = await tx.selectFrom('pt_site').select(['languages', 'default_language', 'timezone']).executeTakeFirstOrThrow()
  let referredBy: string | null = null
  if (opts.referral) {
    const ref = await tx.selectFrom('pt_subscription').select('referral_code').where('referral_code', '=', opts.referral).executeTakeFirst()
    referredBy = ref?.referral_code ?? null
  }
  await sql`
    INSERT INTO pt_subscription (intercessor_id, delivery, language, timezone, referral_code, referred_by, last_activity_at, checkin_cycle_started_at)
    VALUES (${intercessorId}, 'app', ${opts.language && site.languages.includes(opts.language) ? opts.language : site.default_language},
            ${opts.timezone || site.timezone}, ${shortCode(6)}, ${referredBy}, now(), now())
    ON CONFLICT (org_id, intercessor_id) WHERE delivery = 'app' DO NOTHING
  `.execute(tx)
  return (await appSubscription(tx, intercessorId))!
}

export function commitmentJson(c: CommitmentRow) {
  return {
    id: c.id,
    campaign_id: c.campaign_id,
    kind: c.kind,
    frequency: c.frequency,
    days_of_week: (c.days_of_week ?? []).map(Number),
    time: c.time,
    timezone: c.timezone,
    duration_min: c.duration_min,
    dates: (c.dates ?? []).map(d => new Date(d).toISOString()),
    starts_on: toIsoDate(c.starts_on as unknown as string),
    ends_on: toIsoDate(c.ends_on as unknown as string | null),
    paused: c.paused,
    // Personal-start campaigns: the entry the person is on.
    current_entry: c.entries_done + 1
  }
}

export function campaignJson(c: CampaignRow, siteDefaultDuration: number) {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    kind: isSideCampaign(c) ? 'side' : 'main',
    status: campaignStatus(c),
    goal: c.goal,
    goal_target: c.goal_target,
    cadence: c.cadence,
    start_mode: c.start_mode,
    start_date: c.start_date,
    end_date: c.end_date,
    length_days: c.length_days,
    timezone: c.timezone,
    duration: durationRule(c.goal, c.track_time),
    duration_options: durationOptions(c),
    default_duration_min: defaultDuration(c, siteDefaultDuration),
    slot_minutes: c.goal === 'coverage' ? slotMinutes(c) : null
  }
}
