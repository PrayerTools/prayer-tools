// Global reminder sweep: claims due commitments with SKIP LOCKED plus a 5-minute lease, then
// handles each inside its org; `pt_reminder_sent` is reserved before sending so a day is never sent twice.
import { sql } from 'kysely'
import { withOrg, type Tx } from '@prayertools/shared/db/scope'
import { daysBetween, localDateOf, toIsoDate } from '@prayertools/shared/dates'
import { entryNumber, nextReminderUtc } from '@prayertools/shared/schedule'
import { normalizeCampaign, ruleOf } from '@prayertools/shared/subscriptions'
import { campaignEntries } from '@prayertools/shared/content'
import { MISSES_BEFORE_WEEKLY, positionOf } from '@prayertools/shared/progress'
import { primaryEmailOf } from '@prayertools/shared/crm'
import { isSuppressed } from '@prayertools/shared/email/suppression'
import { loadSiteMailContext, reminderEmail, type SiteMailContext } from '@prayertools/shared/email/templates'
import type { OutgoingMail } from '@prayertools/shared/email/transport'
import { logEmails, type EmailLogEntry } from '@prayertools/shared/email/log'
import { prayUrl } from '@prayertools/shared/links'
import type { WorkerContext } from './context'
import { personLanguage, personLinks, siteMail, siteRow } from './mail'
import { groupBy, mapPool, MINUTE, HOUR } from './util'
import type { Logger } from './log'

export const CLAIM_LEASE_MINUTES = 5
// A reminder more than this late is skipped: it would arrive long after the
// time the person chose.
export const MAX_LATE_MS = 6 * HOUR
export const LATE_ALERT_MS = 10 * MINUTE

export interface Claimed {
  id: string
  org_id: string
  next_reminder_utc: Date
}

export type Outcome = 'sent' | 'duplicate' | 'suppressed' | 'stale' | 'ineligible' | 'changed' | 'no_email' | 'failed' | 'finished' | 'prayed' | 'slowed'

export async function claimDue(ctx: WorkerContext, now: Date, limit: number): Promise<Claimed[]> {
  const res = await sql<Claimed>`
    WITH due AS (
      SELECT c.id
      FROM pt_commitment c
      JOIN pt_subscription s ON s.id = c.subscription_id
      WHERE c.next_reminder_utc IS NOT NULL
        AND c.next_reminder_utc <= ${now}::timestamptz
        AND NOT c.paused
        AND (c.claimed_at IS NULL OR c.claimed_at < ${now}::timestamptz - make_interval(mins => ${CLAIM_LEASE_MINUTES}))
        AND s.status = 'active' AND s.delivery = 'email' AND s.verified_at IS NOT NULL
      ORDER BY c.next_reminder_utc
      LIMIT ${limit}
      FOR UPDATE OF c SKIP LOCKED
    )
    UPDATE pt_commitment c SET claimed_at = ${now}::timestamptz
    FROM due WHERE c.id = due.id
    RETURNING c.id::text AS id, c.org_id::text AS org_id, c.next_reminder_utc
  `.execute(ctx.admin)
  return res.rows.map(r => ({ ...r, next_reminder_utc: new Date(r.next_reminder_utc) }))
}

// Due commitments whose subscription can no longer get reminders (inactive,
// unsubscribed, app delivery) stop being due. Found across sites, cleared
// inside each org.
export async function clearIneligible(ctx: WorkerContext, now: Date, log: Logger): Promise<number> {
  const res = await sql<{ id: string, org_id: string }>`
    SELECT c.id::text AS id, c.org_id::text AS org_id
    FROM pt_commitment c
    JOIN pt_subscription s ON s.id = c.subscription_id
    WHERE c.next_reminder_utc IS NOT NULL AND c.next_reminder_utc <= ${now}::timestamptz AND NOT c.paused
      AND NOT (s.status = 'active' AND s.delivery = 'email' AND s.verified_at IS NOT NULL)
    LIMIT 1000
  `.execute(ctx.admin)
  let n = 0
  for (const [orgId, rows] of groupBy(res.rows, r => r.org_id)) {
    try {
      await withOrg(ctx.app, orgId, async (tx) => {
        const r = await tx.updateTable('pt_commitment').set({ next_reminder_utc: null, claimed_at: null }).where('id', 'in', rows.map(x => x.id)).executeTakeFirst()
        n += Number(r.numUpdatedRows ?? 0)
      })
    } catch (err) {
      log.error('reminders.clear_ineligible_failed', { site: orgId, err })
    }
  }
  return n
}

// Age of the oldest due reminder that has not gone out: the "reminders
// running late" signal.
export async function oldestDueAgeMs(ctx: WorkerContext, now: Date): Promise<number> {
  const res = await sql<{ oldest: Date | null }>`
    SELECT min(c.next_reminder_utc) AS oldest
    FROM pt_commitment c
    JOIN pt_subscription s ON s.id = c.subscription_id
    WHERE c.next_reminder_utc IS NOT NULL AND c.next_reminder_utc <= ${now}::timestamptz AND NOT c.paused
      AND c.next_reminder_utc > ${now}::timestamptz - make_interval(secs => ${MAX_LATE_MS / 1000})
      AND s.status = 'active' AND s.delivery = 'email' AND s.verified_at IS NOT NULL
  `.execute(ctx.admin)
  const oldest = res.rows[0]?.oldest
  return oldest ? Math.max(0, now.getTime() - new Date(oldest).getTime()) : 0
}

interface Prepared {
  mail: OutgoingMail
  sent: EmailLogEntry
  localDate: string
  next: Date | null
}

type Step = { outcome: Exclude<Outcome, 'sent' | 'failed'> } | { outcome: 'send', prepared: Prepared }

async function advance(tx: Tx, id: string, occurrence: Date, next: Date | null): Promise<void> {
  await tx
    .updateTable('pt_commitment')
    .set({ next_reminder_utc: next, claimed_at: null })
    .where('id', '=', id)
    .where('next_reminder_utc', '=', occurrence)
    .execute()
}

// Reminders sent since the person last moved forward went unopened. After
// MISSES_BEFORE_WEEKLY of them, one goes out per week until they open one.
async function slowedDown(tx: Tx, commitmentId: string, advancedOn: string | null, localDate: string): Promise<boolean> {
  let q = tx.selectFrom('pt_reminder_sent').select('local_date').where('commitment_id', '=', commitmentId)
  const advanced = toIsoDate(advancedOn)
  if (advanced) q = q.where('local_date', '>', advanced)
  const sent = await q.orderBy('local_date', 'desc').limit(MISSES_BEFORE_WEEKLY).execute()
  if (sent.length < MISSES_BEFORE_WEEKLY) return false
  return daysBetween(toIsoDate(sent[0]!.local_date as unknown as string)!, localDate) < 7
}

// Everything up to the send, in one org transaction: eligibility, the
// suppression check, and the dedupe reservation.
async function prepare(tx: Tx, claimed: Claimed, now: Date, mailCtx: Map<string, Promise<SiteMailContext>>): Promise<Step> {
  const c = await tx.selectFrom('pt_commitment').selectAll().where('id', '=', claimed.id).executeTakeFirst()
  const occurrence = claimed.next_reminder_utc
  if (!c || !c.next_reminder_utc || c.next_reminder_utc.getTime() !== occurrence.getTime()) return { outcome: 'changed' }
  const sub = await tx.selectFrom('pt_subscription').selectAll().where('id', '=', c.subscription_id).executeTakeFirst()
  const campaign = await tx.selectFrom('pt_campaign').selectAll().where('id', '=', c.campaign_id).executeTakeFirst()
  const site = await siteRow(tx)
  const org = await tx.selectFrom('orgs').select('suspended_at').where('id', '=', claimed.org_id).executeTakeFirst()
  const eligible = sub && campaign && site
    && sub.status === 'active' && sub.delivery === 'email' && !!sub.verified_at && !sub.anonymized_at
    && !campaign.ended_at && site.status !== 'archived'
  if (!eligible) {
    await advance(tx, c.id, occurrence, null)
    return { outcome: 'ineligible' }
  }
  const rule = ruleOf(c)
  const lateFloor = new Date(now.getTime() - MAX_LATE_MS)
  const next = nextReminderUtc(rule, occurrence > lateFloor ? occurrence : lateFloor)
  if (occurrence < lateFloor) {
    await advance(tx, c.id, occurrence, next)
    return { outcome: 'stale' }
  }
  if (org?.suspended_at) {
    await advance(tx, c.id, occurrence, next)
    return { outcome: 'ineligible' }
  }
  const localDate = localDateOf(occurrence, c.timezone)
  let day: number | null
  if (campaign.start_mode === 'join') {
    const pos = positionOf(c, campaign.cadence, await campaignEntries(tx, normalizeCampaign(campaign)), occurrence)
    if (pos.finished) {
      await advance(tx, c.id, occurrence, null)
      return { outcome: 'finished' }
    }
    if (pos.movedToday) {
      await advance(tx, c.id, occurrence, next)
      return { outcome: 'prayed' }
    }
    if (await slowedDown(tx, c.id, c.advanced_on, localDate)) {
      await advance(tx, c.id, occurrence, next)
      return { outcome: 'slowed' }
    }
    day = pos.current
  } else {
    const entry = campaign.start_date ? entryNumber(campaign.start_date, campaign.cadence, localDate) : 0
    day = entry > 0 ? entry : null
  }
  const email = sub.contact_id ? await primaryEmailOf(tx, sub.contact_id) : null
  if (!email) {
    await advance(tx, c.id, occurrence, null)
    return { outcome: 'no_email' }
  }
  if (await isSuppressed(tx, email.email)) {
    await advance(tx, c.id, occurrence, next)
    return { outcome: 'suppressed' }
  }
  const reserved = await tx
    .insertInto('pt_reminder_sent')
    .values({ commitment_id: c.id, local_date: localDate, sent_at: now })
    .onConflict(oc => oc.doNothing())
    .returning('commitment_id')
    .executeTakeFirst()
  if (!reserved) {
    await advance(tx, c.id, occurrence, next)
    return { outcome: 'duplicate' }
  }

  let ctxP = mailCtx.get(claimed.org_id)
  if (!ctxP) {
    ctxP = loadSiteMailContext(tx, claimed.org_id)
    mailCtx.set(claimed.org_id, ctxP)
    ctxP.catch(() => mailCtx.delete(claimed.org_id))
  }
  const ctx = await ctxP
  const lang = personLanguage(sub.language, site)
  const links = personLinks(ctx, sub)
  const rendered = reminderEmail(ctx, lang, {
    campaignName: campaign.name,
    day,
    minutes: c.duration_min,
    prayUrl: prayUrl(ctx.siteUrl, campaign.slug, day, lang === site.default_language ? null : lang, claimed.org_id, sub.id),
    manageUrl: links.manageUrl,
    unsubscribeUrl: links.unsubscribeUrl
  })
  const sent: EmailLogEntry = { subscriptionId: sub.id, kind: 'reminder', subject: rendered.subject, campaignId: campaign.id, day, sentAt: now }
  return { outcome: 'send', prepared: { mail: siteMail(ctx, email.email, rendered, 'reminder', links.unsubscribeUrl), sent, localDate, next } }
}

async function handleOne(ctx: WorkerContext, claimed: Claimed, now: Date, mailCtx: Map<string, Promise<SiteMailContext>>, log: Logger): Promise<Outcome> {
  const step = await withOrg(ctx.app, claimed.org_id, tx => prepare(tx, claimed, now, mailCtx))
  if (step.outcome !== 'send') return step.outcome
  const { mail, sent, localDate, next } = step.prepared
  try {
    await ctx.sendMail(mail)
  } catch (err) {
    // Release the day so the retry after the lease expires can send it.
    await withOrg(ctx.app, claimed.org_id, tx => tx.deleteFrom('pt_reminder_sent').where('commitment_id', '=', claimed.id).where('local_date', '=', localDate).execute())
    log.error('reminders.send_failed', { site: claimed.org_id, commitment: claimed.id, err })
    return 'failed'
  }
  await withOrg(ctx.app, claimed.org_id, async (tx) => {
    await advance(tx, claimed.id, claimed.next_reminder_utc, next)
    await logEmails(tx, [sent])
  })
  return 'sent'
}

export interface SweepResult {
  claimed: number
  outcomes: Partial<Record<Outcome, number>>
  cleared: number
  lagMs: number
}

export interface SweepOptions {
  batchSize?: number
  concurrency?: number
  maxBatches?: number
}

// Claims and handles due reminders until none are left (or shutdown begins).
export async function runReminderSweep(ctx: WorkerContext, log: Logger, opts: SweepOptions = {}): Promise<SweepResult> {
  const { batchSize = 100, concurrency = 10, maxBatches = 100 } = opts
  const now = ctx.now()
  const outcomes: Partial<Record<Outcome, number>> = {}
  const mailCtx = new Map<string, Promise<SiteMailContext>>()
  let claimedTotal = 0
  const cleared = await clearIneligible(ctx, now, log)
  for (let i = 0; i < maxBatches && !ctx.stopping(); i++) {
    const claimed = await claimDue(ctx, now, batchSize)
    if (claimed.length === 0) break
    claimedTotal += claimed.length
    const results = await mapPool(claimed, concurrency, c => handleOne(ctx, c, now, mailCtx, log))
    results.forEach((r, idx) => {
      const outcome: Outcome = r.ok ? r.value : 'failed'
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
      if (!r.ok) log.error('reminders.handle_failed', { site: claimed[idx]!.org_id, commitment: claimed[idx]!.id, err: r.error })
    })
  }
  const lagMs = await oldestDueAgeMs(ctx, now)
  const fields = { claimed: claimedTotal, cleared, ...outcomes, lag_seconds: Math.round(lagMs / 1000) }
  if (lagMs > LATE_ALERT_MS) log.alert('reminders.late', fields)
  else if (claimedTotal || cleared) log.info('reminders.sweep', fields)
  else log.debug('reminders.sweep', fields)
  return { claimed: claimedTotal, outcomes, cleared, lagMs }
}
