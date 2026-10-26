// Subscriptions (a person on a site) and commitments (their prayer times in a
// campaign). Used by the public server, the app API, the admin app and the
// worker; every function runs inside the site's org.
import { sql, type Selectable } from 'kysely'
import type { Tx } from './db/scope'
import type { PtCampaignTable, PtCommitmentTable, PtSubscriptionTable } from './db/schema'
import { todayIn, toIsoDate } from './dates'
import { nextReminderUtc, validateRule, type CommitmentRule } from './schedule'
import { campaignEntries } from './content'
import { hashToken, randomToken, shortCode } from './tokens'
import { consentHistory, consentState, markChannelVerified, primaryEmailOf, setConsent, upsertContact, type ConsentCapture } from './crm'
import { bumpStat } from './stats'
import { durationOptions, durationRule } from './setup'

export type CampaignRow = Selectable<PtCampaignTable>
export type SubscriptionRow = Selectable<PtSubscriptionTable>
export type CommitmentRow = Selectable<PtCommitmentTable>

export const VERIFY_TOKEN_DAYS = 7

export function normalizeCampaign<T extends { start_date: unknown, end_date: unknown }>(c: T): T & { start_date: string | null, end_date: string | null } {
  return { ...c, start_date: toIsoDate(c.start_date as Date | string | null), end_date: toIsoDate(c.end_date as Date | string | null) }
}

export function ruleOf(c: Pick<CommitmentRow, 'kind' | 'frequency' | 'days_of_week' | 'time' | 'timezone' | 'duration_min' | 'dates' | 'starts_on' | 'ends_on' | 'paused'>): CommitmentRule {
  return {
    kind: c.kind,
    frequency: c.frequency,
    days_of_week: (c.days_of_week ?? []).map(Number),
    time: c.time,
    timezone: c.timezone,
    duration_min: c.duration_min,
    dates: c.dates ?? [],
    starts_on: toIsoDate(c.starts_on as unknown as string)!,
    ends_on: toIsoDate(c.ends_on as unknown as string | null),
    paused: c.paused
  }
}

export interface RuleInput {
  kind?: 'recurring' | 'dates'
  frequency?: 'daily' | 'weekly'
  days_of_week?: number[]
  time: string
  timezone?: string
  duration_min?: number | null
  dates?: string[]
}

// A commitment's date window: shared-calendar campaigns run from the later of
// the campaign start and the join date to the campaign end; personal-start
// commitments run from the person's own start and store no end: a person
// finishes by reaching the last entry (see progress.ts).
export async function commitmentWindow(tx: Tx, campaign: CampaignRow, subscriptionId: string | null, tz: string): Promise<{ starts_on: string, ends_on: string | null }> {
  const c = normalizeCampaign(campaign)
  const today = todayIn(tz)
  if (c.start_mode === 'join') {
    let anchor = today
    if (subscriptionId) {
      const first = await tx
        .selectFrom('pt_commitment')
        .select(eb => eb.fn.min('starts_on').as('first'))
        .where('subscription_id', '=', subscriptionId)
        .where('campaign_id', '=', c.id)
        .executeTakeFirst()
      const f = toIsoDate(first?.first as string | null | undefined)
      if (f) anchor = f
    }
    return { starts_on: anchor, ends_on: null }
  }
  const start = c.start_date && c.start_date > today ? c.start_date : today
  return { starts_on: start, ends_on: c.end_mode === 'date' ? c.end_date : null }
}

export function validateRuleForCampaign(input: RuleInput, campaign: CampaignRow): string[] {
  const kind = input.kind ?? 'recurring'
  const errors = validateRule({ ...input, kind, frequency: input.frequency ?? null, days_of_week: input.days_of_week ?? [], dates: input.dates ?? [], duration_min: input.duration_min ?? null })
  if (kind === 'dates' && campaign.goal !== 'coverage') errors.push('kind')
  if (kind === 'recurring' && campaign.cadence === 'weekly' && input.frequency === 'daily') {
    // A weekly campaign still lets people pray daily; nothing to reject.
  }
  const rule = durationRule(campaign.goal, campaign.track_time)
  if (rule === 'required' && !input.duration_min) errors.push('duration_min')
  else if (campaign.goal === 'coverage' && !durationOptions(campaign).includes(input.duration_min!)) errors.push('duration_min')
  return errors
}

// Reminders go out only for active, verified, email-delivered subscriptions.
function remindersOn(sub: Pick<SubscriptionRow, 'status' | 'delivery' | 'verified_at'>): boolean {
  return sub.status === 'active' && sub.delivery === 'email' && !!sub.verified_at
}

// A person has one commitment per personal-start campaign, because it carries
// their progress: adding another updates its prayer time instead, and
// restarts the campaign when they had finished it.
export async function insertCommitment(tx: Tx, sub: SubscriptionRow, campaign: CampaignRow, input: RuleInput): Promise<CommitmentRow> {
  if (campaign.start_mode === 'join') {
    const existing = await tx.selectFrom('pt_commitment').select(['id', 'entries_done', 'timezone']).where('subscription_id', '=', sub.id).where('campaign_id', '=', campaign.id).executeTakeFirst()
    if (existing) {
      const entries = await campaignEntries(tx, normalizeCampaign(campaign))
      if (entries && existing.entries_done >= entries) {
        await tx.updateTable('pt_commitment').set({ entries_done: 0, advanced_on: null, starts_on: todayIn(input.timezone || existing.timezone) }).where('id', '=', existing.id).execute()
      }
      return (await updateCommitment(tx, sub, existing.id, input))!
    }
  }
  const tz = input.timezone || sub.timezone
  const window = await commitmentWindow(tx, campaign, sub.id, tz)
  const kind = input.kind ?? 'recurring'
  const rule = durationRule(campaign.goal, campaign.track_time)
  const values = {
    subscription_id: sub.id,
    campaign_id: campaign.id,
    kind,
    frequency: kind === 'dates' ? null : (input.frequency ?? 'daily'),
    days_of_week: kind === 'dates' || input.frequency !== 'weekly' ? [] : [...new Set(input.days_of_week ?? [])].sort(),
    time: input.time,
    timezone: tz,
    duration_min: rule === 'hidden' ? null : (input.duration_min ?? null),
    dates: kind === 'dates' ? (input.dates ?? []).map(d => new Date(d)) : [],
    starts_on: window.starts_on,
    ends_on: window.ends_on
  }
  const next = remindersOn(sub) ? nextReminderUtc({ ...values, paused: false } as CommitmentRule) : null
  return await tx
    .insertInto('pt_commitment')
    .values({ ...values, days_of_week: sql`${`{${values.days_of_week.join(',')}}`}::smallint[]`, dates: sql`${`{${values.dates.map(d => `"${d.toISOString()}"`).join(',')}}`}::timestamptz[]`, next_reminder_utc: next })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function updateCommitment(tx: Tx, sub: SubscriptionRow, commitmentId: string, patch: Partial<RuleInput> & { paused?: boolean }): Promise<CommitmentRow | null> {
  const existing = await tx.selectFrom('pt_commitment').selectAll().where('id', '=', commitmentId).where('subscription_id', '=', sub.id).executeTakeFirst()
  if (!existing) return null
  const merged = {
    ...ruleOf(existing),
    ...(patch.frequency ? { frequency: patch.frequency } : {}),
    ...(patch.days_of_week ? { days_of_week: [...new Set(patch.days_of_week)].sort() } : {}),
    ...(patch.time ? { time: patch.time } : {}),
    ...(patch.timezone ? { timezone: patch.timezone } : {}),
    ...(patch.duration_min !== undefined ? { duration_min: patch.duration_min } : {}),
    ...(patch.paused !== undefined ? { paused: patch.paused } : {})
  }
  if (merged.frequency === 'daily') merged.days_of_week = []
  const next = remindersOn(sub) ? nextReminderUtc(merged) : null
  return await tx
    .updateTable('pt_commitment')
    .set({
      frequency: merged.frequency,
      days_of_week: sql`${`{${merged.days_of_week.join(',')}}`}::smallint[]`,
      time: merged.time,
      timezone: merged.timezone,
      duration_min: merged.duration_min,
      paused: merged.paused ?? false,
      next_reminder_utc: next,
      claimed_at: null,
      updated_at: new Date()
    })
    .where('id', '=', commitmentId)
    .returningAll()
    .executeTakeFirst() ?? null
}

// Recomputes next_reminder_utc for every commitment of a subscription, after
// verification, a status change or a timezone change.
export async function refreshReminders(tx: Tx, subscriptionId: string): Promise<void> {
  const sub = await tx.selectFrom('pt_subscription').selectAll().where('id', '=', subscriptionId).executeTakeFirst()
  if (!sub) return
  const commitments = await tx.selectFrom('pt_commitment').selectAll().where('subscription_id', '=', subscriptionId).execute()
  for (const c of commitments) {
    const next = remindersOn(sub) ? nextReminderUtc(ruleOf(c)) : null
    await tx.updateTable('pt_commitment').set({ next_reminder_utc: next, claimed_at: null }).where('id', '=', c.id).execute()
  }
}

// ── Signup ─────────────────────────────────────────────────────────────────

export interface SignupInput {
  campaign: CampaignRow
  email: string
  name?: string | null
  language: string
  timezone: string
  commitments: RuleInput[]
  consents: { siteUpdates?: boolean, custom?: string[] }
  consentLabels?: Record<string, string>
  answers?: Record<string, unknown>
  referredBy?: string | null
  joinedFrom?: string | null
  // Google / Apple sign-in: the address is already verified.
  preVerified?: boolean
  capture: Omit<ConsentCapture, 'wording'>
}

export interface SignupResult {
  subscription: SubscriptionRow
  contactId: string
  channelId: string
  verifyToken: string | null
  newSubscription: boolean
  // The address became verified with this signup (Google / Apple sign-in, or a contact already verified on the site).
  verifiedNow: boolean
}

export async function createWebSignup(tx: Tx, input: SignupInput): Promise<SignupResult> {
  const contact = await upsertContact(tx, {
    email: input.email,
    name: input.name,
    data: { ...(input.answers ?? {}), pt_language: input.language },
    source: 'web signup'
  })
  let sub = await tx.selectFrom('pt_subscription').selectAll().where('contact_id', '=', contact.contactId).executeTakeFirst()
  const newSubscription = !sub
  const wasVerified = !!sub?.verified_at
  let verifyToken: string | null = null
  const verified = input.preVerified || !!sub?.verified_at || contact.verified
  if (!sub) {
    let referredBy: string | null = null
    if (input.referredBy) {
      const ref = await tx.selectFrom('pt_subscription').select('referral_code').where('referral_code', '=', input.referredBy).executeTakeFirst()
      referredBy = ref?.referral_code ?? null
    }
    sub = await tx
      .insertInto('pt_subscription')
      .values({
        contact_id: contact.contactId,
        language: input.language,
        timezone: input.timezone,
        referral_code: shortCode(6),
        referred_by: referredBy,
        joined_from: input.joinedFrom?.slice(0, 100) ?? null,
        verified_at: verified ? new Date() : null,
        last_activity_at: new Date(),
        checkin_cycle_started_at: new Date()
      })
      .returningAll()
      .executeTakeFirstOrThrow()
  } else {
    sub = await tx
      .updateTable('pt_subscription')
      .set({
        language: input.language,
        timezone: input.timezone,
        ...(sub.status === 'unsubscribed' || sub.status === 'inactive' || sub.status === 'completed' ? { status: 'active', unsubscribed_at: null, inactive_at: null, completed_at: null } : {}),
        ...(verified && !sub.verified_at ? { verified_at: new Date() } : {}),
        last_activity_at: new Date(),
        updated_at: new Date()
      })
      .where('id', '=', sub.id)
      .returningAll()
      .executeTakeFirstOrThrow()
  }
  if (!sub.verified_at) {
    verifyToken = randomToken(24)
    sub = await tx
      .updateTable('pt_subscription')
      .set({ verify_token_hash: hashToken(verifyToken), verify_expires_at: new Date(Date.now() + VERIFY_TOKEN_DAYS * 86_400_000) })
      .where('id', '=', sub.id)
      .returningAll()
      .executeTakeFirstOrThrow()
  } else {
    await markChannelVerified(tx, contact.channelId)
    const intercessorId = await linkIntercessor(tx, input.email)
    if (sub.intercessor_id !== intercessorId) {
      sub = await tx.updateTable('pt_subscription').set({ intercessor_id: intercessorId }).where('id', '=', sub.id).returningAll().executeTakeFirstOrThrow()
    }
  }
  for (const c of input.commitments) await insertCommitment(tx, sub, input.campaign, c)

  const capture = (key: string, label?: string): ConsentCapture => ({ ...input.capture, wording: label ? { label } : { key } })
  if (input.consents.siteUpdates) await setConsent(tx, contact.channelId, 'site_updates', true, capture('consent.site_updates'))
  for (const key of input.consents.custom ?? []) {
    await setConsent(tx, contact.channelId, `custom:${key}`, true, capture(`custom:${key}`, input.consentLabels?.[key]))
  }

  const today = todayIn(input.campaign.timezone)
  if (newSubscription) {
    await bumpStat(tx, input.campaign.id, today, 'signups')
    if (sub.referred_by) await bumpStat(tx, input.campaign.id, today, 'share_signups')
  }
  if (sub.verified_at && newSubscription) await bumpStat(tx, input.campaign.id, today, 'verifications')
  return { subscription: sub, contactId: contact.contactId, channelId: contact.channelId, verifyToken, newSubscription, verifiedNow: !!sub.verified_at && !wasVerified }
}

// Global identity for a verified email address. `pt_intercessor` has no RLS;
// the lookup is always by the explicit address.
export async function linkIntercessor(tx: Tx, email: string): Promise<string> {
  const normalized = email.trim().toLowerCase()
  const existing = await tx.selectFrom('pt_intercessor').select('id').where(eb => eb.fn('lower', ['email']), '=', normalized).executeTakeFirst()
  if (existing) {
    await tx.updateTable('pt_intercessor').set({ last_active_at: new Date() }).where('id', '=', existing.id).execute()
    return existing.id
  }
  const row = await tx
    .insertInto('pt_intercessor')
    .values({ email: normalized, email_verified_at: new Date(), last_active_at: new Date() })
    .onConflict(oc => oc.expression(sql`lower(email)`).where('email', 'is not', null).doNothing())
    .returning('id')
    .executeTakeFirst()
  if (row) return row.id
  const again = await tx.selectFrom('pt_intercessor').select('id').where(eb => eb.fn('lower', ['email']), '=', normalized).executeTakeFirstOrThrow()
  return again.id
}

export async function verifySubscription(tx: Tx, token: string): Promise<SubscriptionRow | null> {
  const sub = await tx.selectFrom('pt_subscription').selectAll().where('verify_token_hash', '=', hashToken(token)).executeTakeFirst()
  if (!sub) return null
  if (sub.verify_expires_at && new Date(sub.verify_expires_at) < new Date()) return null
  const email = sub.contact_id ? await primaryEmailOf(tx, sub.contact_id) : null
  const intercessorId = email ? await linkIntercessor(tx, email.email) : sub.intercessor_id
  if (email) await markChannelVerified(tx, email.channelId)
  const updated = await tx
    .updateTable('pt_subscription')
    .set({ verified_at: sub.verified_at ?? new Date(), verify_token_hash: null, verify_expires_at: null, intercessor_id: intercessorId, updated_at: new Date() })
    .where('id', '=', sub.id)
    .returningAll()
    .executeTakeFirstOrThrow()
  await refreshReminders(tx, sub.id)
  if (!sub.verified_at) {
    const campaign = await tx.selectFrom('pt_commitment').select('campaign_id').where('subscription_id', '=', sub.id).orderBy('created_at', 'desc').executeTakeFirst()
    const c = campaign ? await tx.selectFrom('pt_campaign').select(['id', 'timezone']).where('id', '=', campaign.campaign_id).executeTakeFirst() : null
    await bumpStat(tx, c?.id ?? null, todayIn(c?.timezone ?? 'UTC'), 'verifications')
  }
  return updated
}

export async function setSubscriptionStatus(tx: Tx, subscriptionId: string, status: SubscriptionRow['status']): Promise<void> {
  const now = new Date()
  await tx
    .updateTable('pt_subscription')
    .set({
      status,
      unsubscribed_at: status === 'unsubscribed' ? now : null,
      inactive_at: status === 'inactive' ? now : null,
      completed_at: status === 'completed' ? now : null,
      ...(status === 'active' ? { checkin_cycle_started_at: now, last_activity_at: now } : {}),
      updated_at: now
    })
    .where('id', '=', subscriptionId)
    .execute()
  await refreshReminders(tx, subscriptionId)
}

// Activity (a prayer session, an Amen, a check-in answer) keeps a subscription
// alive and reactivates an inactive one; `unsubscribed` is sticky.
export async function recordActivity(tx: Tx, subscriptionId: string): Promise<void> {
  const sub = await tx.selectFrom('pt_subscription').select(['status']).where('id', '=', subscriptionId).executeTakeFirst()
  if (!sub) return
  await tx.updateTable('pt_subscription').set({ last_activity_at: new Date() }).where('id', '=', subscriptionId).execute()
  if (sub.status === 'inactive') await setSubscriptionStatus(tx, subscriptionId, 'active')
}

// ── Self-service data ──────────────────────────────────────────────────────

export async function personData(tx: Tx, subscriptionId: string) {
  const sub = await tx.selectFrom('pt_subscription').selectAll().where('id', '=', subscriptionId).executeTakeFirst()
  if (!sub) return null
  const contact = sub.contact_id ? await tx.selectFrom('crm_records').select(['name', 'data', 'created_at']).where('id', '=', sub.contact_id).executeTakeFirst() : null
  const email = sub.contact_id ? await primaryEmailOf(tx, sub.contact_id) : null
  const commitments = await tx
    .selectFrom('pt_commitment as c')
    .innerJoin('pt_campaign as k', 'k.id', 'c.campaign_id')
    .select(['k.name as campaign', 'c.kind', 'c.frequency', 'c.days_of_week', 'c.time', 'c.timezone', 'c.duration_min', 'c.dates', 'c.starts_on', 'c.ends_on', 'c.paused'])
    .where('c.subscription_id', '=', subscriptionId)
    .execute()
  return {
    profile: {
      name: contact?.name ?? null,
      email: email?.email ?? null,
      language: sub.language,
      timezone: sub.timezone,
      status: sub.status,
      signed_up: sub.created_at,
      verified: sub.verified_at
    },
    custom_answers: Object.fromEntries(Object.entries((contact?.data ?? {}) as Record<string, unknown>).filter(([k]) => k.startsWith('pt_') && k !== 'pt_language')),
    reminder_times: commitments,
    consent: email ? await consentState(tx, email.channelId) : {},
    consent_history: email ? await consentHistory(tx, email.channelId) : []
  }
}

// Deletes the person's data on this site: subscription, commitments and the
// CRM contact with its address. Consent proof events stay (the CRM keeps
// them past erasure). A global intercessor left without subscriptions is
// removed by the worker's retention sweep, which can see every site.
export async function deleteSubscriptionData(tx: Tx, subscriptionId: string): Promise<void> {
  const sub = await tx.selectFrom('pt_subscription').select(['contact_id', 'intercessor_id']).where('id', '=', subscriptionId).executeTakeFirst()
  if (!sub) return
  await tx.deleteFrom('pt_subscription').where('id', '=', subscriptionId).execute()
  if (sub.contact_id) {
    const channels = await tx.selectFrom('crm_contact_channels').select('channel_id').where('record_id', '=', sub.contact_id).execute()
    await tx.deleteFrom('crm_records').where('id', '=', sub.contact_id).execute()
    for (const ch of channels) await deleteChannelIfUnused(tx, ch.channel_id)
  }
}

// An address still linked to another contact, or to an inbox conversation
// (whose foreign key has no cascade), is kept.
async function deleteChannelIfUnused(tx: Tx, channelId: string): Promise<boolean> {
  const linked = await tx.selectFrom('crm_contact_channels').select('id').where('channel_id', '=', channelId).executeTakeFirst()
  if (linked) return false
  const conversation = await tx.selectFrom('inbox_conversations').select('id').where('channel_id', '=', channelId).executeTakeFirst()
  if (conversation) return false
  await tx.deleteFrom('crm_channels').where('id', '=', channelId).execute()
  return true
}

export const ANONYMIZED_NAME = 'Anonymized'

// Retention: removes the person's data on this site, keeping the subscription row for counts.
// Consent proof events keep their address fingerprint but lose the address itself.
export async function anonymizeSubscription(tx: Tx, subscriptionId: string, now: Date = new Date()): Promise<boolean> {
  const sub = await tx.selectFrom('pt_subscription').select(['contact_id', 'anonymized_at']).where('id', '=', subscriptionId).executeTakeFirst()
  if (!sub || sub.anonymized_at) return false
  await tx.deleteFrom('pt_commitment').where('subscription_id', '=', subscriptionId).execute()
  if (sub.contact_id) {
    const channels = await tx.selectFrom('crm_contact_channels').select('channel_id').where('record_id', '=', sub.contact_id).execute()
    await tx.deleteFrom('crm_contact_channels').where('record_id', '=', sub.contact_id).execute()
    for (const ch of channels) {
      await tx.updateTable('crm_consent_events').set({ channel_value: ANONYMIZED_NAME, ip: null, user_agent: null }).where('channel_id', '=', ch.channel_id).execute()
      await deleteChannelIfUnused(tx, ch.channel_id)
    }
    await sql`DELETE FROM crm_record_field_entries WHERE record_id = ${sub.contact_id}`.execute(tx)
    await tx.updateTable('crm_record_activity').set({ old_value: null, new_value: null }).where('record_id', '=', sub.contact_id).execute()
    await tx
      .updateTable('crm_records')
      .set({ name: ANONYMIZED_NAME, data: sql`'{}'::jsonb`, updated_at: now })
      .where('id', '=', sub.contact_id)
      .execute()
  }
  await tx
    .updateTable('pt_subscription')
    .set({
      anonymized_at: now,
      intercessor_id: null,
      verify_token_hash: null,
      verify_expires_at: null,
      joined_from: null,
      updated_at: now
    })
    .where('id', '=', subscriptionId)
    .execute()
  return true
}

// Must run on the admin connection: the subscription count spans every site.
export async function deleteIntercessorIfUnused(tx: Tx, intercessorId: string): Promise<boolean> {
  const device = await tx.selectFrom('pt_intercessor_device').select('id').where('intercessor_id', '=', intercessorId).executeTakeFirst()
  if (device) return false
  const res = await sql<{ n: number }>`select count(*)::int as n from pt_subscription where intercessor_id = ${intercessorId}`.execute(tx)
  if ((res.rows[0]?.n ?? 0) > 0) return false
  await tx.deleteFrom('pt_intercessor').where('id', '=', intercessorId).execute()
  return true
}
