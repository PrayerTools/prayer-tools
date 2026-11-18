// The sending engine. `processMarketing` is one pass: resolve due multi-site
// sends, start due emails (materialize their deliveries), then send pending
// deliveries within each org's throttle. Deliveries are claimed (marked with
// `claimed_at`) and committed before the provider is called, so a crash can
// never cause a second send; a claim left behind by a crash is failed, not
// retried.
import { sql, type Kysely } from 'kysely'
import { collectRecipients, defaultConsentedAmong } from './audiences'
import { inOrg } from './db'
import { renderEmail } from './render'
import { addressFingerprint, signToken, unsubscribeUrls } from './tokens'
import type { MarketingDb, MarketingHost, MarketingMail, MarketingTx } from './types'

export const COMPLAINT_PAUSE_RATE = 0.003
// Complaints are measured against at least this many sends, so one complaint
// on a small send doesn't pause a site.
export const COMPLAINT_MIN_VOLUME = 1000
export const COMPLAINT_WINDOW_DAYS = 7
export const CLAIM_TIMEOUT_MS = 15 * 60_000
export const MAX_ATTEMPTS = 3
export const BATCH_SIZE = 50

export interface ProcessOptions {
  // BYPASSRLS connection for the set-based finds across orgs. Typed loosely so
  // a host passes its own Kysely instance.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminDb: Kysely<any>
  // RLS connection; every write to a site's data runs inside that org.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  appDb: Kysely<any>
  host: MarketingHost
  now?: Date
  // Most deliveries sent in this pass, across orgs.
  limit?: number
  log?: (message: string, fields?: Record<string, unknown>) => void
}

export interface ProcessResult {
  resolvedParents: number
  started: number
  // Emails refused by the recipient check.
  refused: number
  sent: number
  failed: number
  skipped: number
  retried: number
  paused: number
  finished: number
}

type Log = NonNullable<ProcessOptions['log']>

export async function processMarketing(opts: ProcessOptions): Promise<ProcessResult> {
  const admin = opts.adminDb as MarketingDb
  const app = opts.appDb as MarketingDb
  const now = opts.now ?? new Date()
  const log: Log = opts.log ?? ((m, f) => console.error(`[marketing] ${m}`, f ?? ''))
  const result: ProcessResult = { resolvedParents: 0, started: 0, refused: 0, sent: 0, failed: 0, skipped: 0, retried: 0, paused: 0, finished: 0 }

  await reapStaleClaims(admin, now)
  result.resolvedParents = await resolveParents(admin, app, opts.host, now, log)
  result.started = await startDue(admin, app, opts.host, now, log)
  await sendDue(admin, app, opts.host, now, opts.limit ?? 1000, result, log)
  await syncParents(admin, now)
  return result
}

// ── Counts ──────────────────────────────────────────────────────────────────

export async function recount(db: MarketingDb | MarketingTx, emailId: string): Promise<void> {
  await sql`
    UPDATE marketing_email e SET
      recipients = c.total, sent = c.sent, skipped = c.skipped, failed = c.failed, updated_at = now()
    FROM (
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE status = 'sent')::int AS sent,
        count(*) FILTER (WHERE status = 'skipped')::int AS skipped,
        count(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM marketing_delivery WHERE email_id = ${emailId}
    ) c
    WHERE e.id = ${emailId}
  `.execute(db)
}

async function finishIfDone(tx: MarketingTx, emailId: string, now: Date): Promise<boolean> {
  const res = await sql`
    UPDATE marketing_email SET status = 'sent', finished_at = ${now}, updated_at = ${now}
    WHERE id = ${emailId} AND status = 'sending'
      AND NOT EXISTS (SELECT 1 FROM marketing_delivery WHERE email_id = ${emailId} AND status = 'pending')
  `.execute(tx)
  return Number(res.numAffectedRows ?? 0) > 0
}

// ── Crash recovery ──────────────────────────────────────────────────────────

async function reapStaleClaims(admin: MarketingDb, now: Date): Promise<void> {
  const stale = await admin
    .updateTable('marketing_delivery')
    .set({ status: 'failed', error: 'Interrupted while sending; not retried so nobody gets it twice.', claimed_at: null, address: null, first_name: null })
    .where('status', '=', 'pending')
    .where('claimed_at', '<', new Date(now.getTime() - CLAIM_TIMEOUT_MS))
    .returning('email_id')
    .execute()
  for (const emailId of new Set(stale.map(s => s.email_id))) await recount(admin, emailId)
}

// ── Multi-site: one email per person ────────────────────────────────────────

// Each person on several chosen sites is assigned to the most recently joined
// site where they consented. Every child email's eligible recipients are
// upserted by address fingerprint, keeping the latest join; children start only
// once every site has been resolved.
async function resolveParents(admin: MarketingDb, app: MarketingDb, host: MarketingHost, now: Date, log: Log): Promise<number> {
  const due = await admin.selectFrom('marketing_parent').select('id').where('status', '=', 'scheduled').where('scheduled_at', '<=', now).execute()
  let resolved = 0
  for (const parent of due) {
    const children = await admin.selectFrom('marketing_email').select(['id', 'org_id', 'audiences']).where('parent_id', '=', parent.id).where('status', '=', 'scheduled').execute()
    let ok = true
    for (const child of children) {
      try {
        await inOrg(app, child.org_id, async (tx) => {
          const r = await collectRecipients(host, tx, child.org_id, child.audiences)
          const rows = dedupeByFingerprint(r.eligible.map(c => ({ parent_id: parent.id, fingerprint: addressFingerprint(c.address), org_id: child.org_id, joined_at: c.joinedAt })))
          for (let i = 0; i < rows.length; i += 1000) {
            await tx
              .insertInto('marketing_parent_recipient')
              .values(rows.slice(i, i + 1000))
              .onConflict(oc => oc.columns(['parent_id', 'fingerprint']).doUpdateSet({
                org_id: eb => eb.ref('excluded.org_id'),
                joined_at: eb => eb.ref('excluded.joined_at')
              }).where(eb => eb('excluded.joined_at', '>', eb.ref('marketing_parent_recipient.joined_at'))))
              .execute()
          }
        })
      } catch (err) {
        ok = false
        log('resolving a multi-site send failed', { parentId: parent.id, orgId: child.org_id, error: String(err) })
      }
    }
    if (!ok) continue
    const res = await admin
      .updateTable('marketing_parent')
      .set({ status: 'sending', resolved_at: now, started_at: now, updated_at: now })
      .where('id', '=', parent.id)
      .where('status', '=', 'scheduled')
      .executeTakeFirst()
    if (Number(res.numUpdatedRows) > 0) resolved++
  }
  return resolved
}

function dedupeByFingerprint<T extends { fingerprint: string, joined_at: Date }>(rows: T[]): T[] {
  const best = new Map<string, T>()
  for (const r of rows) {
    const seen = best.get(r.fingerprint)
    if (!seen || r.joined_at > seen.joined_at) best.set(r.fingerprint, r)
  }
  return [...best.values()]
}

// ── Start: materialize deliveries ───────────────────────────────────────────

async function startDue(admin: MarketingDb, app: MarketingDb, host: MarketingHost, now: Date, log: Log): Promise<number> {
  const due = await admin
    .selectFrom('marketing_email as e')
    .leftJoin('marketing_parent as p', 'p.id', 'e.parent_id')
    .select(['e.id', 'e.org_id'])
    .where('e.status', '=', 'scheduled')
    .where('e.scheduled_at', '<=', now)
    .where(eb => eb.or([eb('e.parent_id', 'is', null), eb('p.resolved_at', 'is not', null)]))
    .orderBy('e.scheduled_at')
    .execute()
  let started = 0
  for (const email of due) {
    try {
      const ok = await inOrg(app, email.org_id, async (tx) => {
        const row = await tx
          .updateTable('marketing_email')
          .set({ status: 'sending', started_at: now, updated_at: now })
          .where('id', '=', email.id)
          .where('status', '=', 'scheduled')
          .returning(['id', 'org_id', 'parent_id', 'audiences'])
          .executeTakeFirst()
        if (!row) return false
        await materialize(host, tx, row)
        return true
      })
      if (ok) started++
    } catch (err) {
      log('starting an email failed', { emailId: email.id, orgId: email.org_id, error: String(err) })
    }
  }
  return started
}

export async function materialize(host: MarketingHost, tx: MarketingTx, email: { id: string, org_id: string, parent_id: string | null, audiences: string[] }): Promise<void> {
  const r = await collectRecipients(host, tx, email.org_id, email.audiences)
  let chosen = r.eligible
  if (email.parent_id) {
    const byFp = new Map(r.eligible.map(c => [addressFingerprint(c.address), c]))
    const fps = [...byFp.keys()]
    // People who joined after the parent was resolved are claimed first-come.
    for (let i = 0; i < fps.length; i += 1000) {
      await tx
        .insertInto('marketing_parent_recipient')
        .values(fps.slice(i, i + 1000).map(fp => ({ parent_id: email.parent_id!, fingerprint: fp, org_id: email.org_id, joined_at: byFp.get(fp)!.joinedAt })))
        .onConflict(oc => oc.columns(['parent_id', 'fingerprint']).doNothing())
        .execute()
    }
    const mine = new Set<string>()
    for (let i = 0; i < fps.length; i += 5000) {
      const rows = await tx
        .selectFrom('marketing_parent_recipient')
        .select('fingerprint')
        .where('parent_id', '=', email.parent_id)
        .where('org_id', '=', email.org_id)
        .where('fingerprint', 'in', fps.slice(i, i + 5000))
        .execute()
      for (const row of rows) mine.add(row.fingerprint)
    }
    chosen = r.eligible.filter(c => mine.has(addressFingerprint(c.address)))
  }
  const rows = [
    ...chosen.map(c => ({ email_id: email.id, contact_id: c.contactId, channel_id: c.channelId, address: c.address, first_name: c.firstName ?? null, language: c.language, purpose: c.purpose, status: 'pending' as const, skip_reason: null })),
    ...r.noConsent.map(c => ({ email_id: email.id, contact_id: c.contactId, channel_id: c.channelId, address: null, first_name: null, language: c.language, purpose: c.purpose, status: 'skipped' as const, skip_reason: 'no_consent' })),
    ...r.suppressed.map(c => ({ email_id: email.id, contact_id: c.contactId, channel_id: c.channelId, address: null, first_name: null, language: c.language, purpose: c.purpose, status: 'skipped' as const, skip_reason: 'suppressed' }))
  ]
  for (let i = 0; i < rows.length; i += 1000) {
    await tx.insertInto('marketing_delivery').values(rows.slice(i, i + 1000)).onConflict(oc => oc.columns(['email_id', 'channel_id']).doNothing()).execute()
  }
  await recount(tx, email.id)
}

// ── Send ────────────────────────────────────────────────────────────────────

interface Claimed {
  id: string
  attempts: number
  mail: MarketingMail
}

interface Outcome {
  id: string
  attempts: number
  providerId?: string | null
  error?: string
  retryable?: boolean
  skip?: string
}

async function sendDue(admin: MarketingDb, app: MarketingDb, host: MarketingHost, now: Date, limit: number, result: ProcessResult, log: Log): Promise<void> {
  const sending = await admin.selectFrom('marketing_email').select(['id', 'org_id']).where('status', '=', 'sending').orderBy('started_at').execute()
  const byOrg = new Map<string, string[]>()
  for (const e of sending) byOrg.set(e.org_id, [...(byOrg.get(e.org_id) ?? []), e.id])
  let remaining = limit

  for (const [orgId, all] of byOrg) {
    try {
      const emailIds: string[] = []
      for (const emailId of all) {
        const problem = await recipientCheck(admin, emailId, orgId)
        if (!problem) {
          emailIds.push(emailId)
          continue
        }
        await inOrg(app, orgId, tx => failEmail(tx, emailId, 'recipient_check', now))
        result.refused++
        log('refused an email whose recipients are not all the site\'s own', { emailId, orgId, ...problem })
      }
      const gate = await inOrg(app, orgId, tx => checkOrgGate(host, tx, orgId, now))
      if (gate.paused) {
        result.paused += gate.paused
        log('paused an org\'s marketing for its complaint rate', { orgId, rate: gate.rate })
        continue
      }
      let budget = Math.min(gate.budget, remaining)
      for (const emailId of emailIds) {
        while (budget > 0) {
          const batch = await inOrg(app, orgId, tx => claimBatch(host, tx, orgId, emailId, Math.min(BATCH_SIZE, budget), now))
          result.skipped += batch.skipped
          if (!batch.items.length) {
            if (batch.skipped === 0) {
              if (await inOrg(app, orgId, tx => finishIfDone(tx, emailId, now))) result.finished++
              break
            }
            continue
          }
          const outcomes = await sendAll(host, batch.items)
          await inOrg(app, orgId, tx => recordOutcomes(tx, emailId, outcomes, now))
          for (const o of outcomes) {
            if (!o.error) result.sent++
            else if (o.retryable && o.attempts < MAX_ATTEMPTS) result.retried++
            else result.failed++
          }
          budget -= outcomes.length
          remaining -= outcomes.length
          if (await inOrg(app, orgId, tx => finishIfDone(tx, emailId, now))) {
            result.finished++
            break
          }
          if (outcomes.every(o => o.error && o.retryable)) break
        }
        if (budget <= 0) break
      }
    } catch (err) {
      log('sending failed for an org', { orgId, error: String(err) })
    }
    if (remaining <= 0) break
  }
}

// A site's send may only reach the site's own people: no more deliveries than
// the site has email addresses, and none to an address of another site.
// Counted on the admin connection with explicit org filters, so the check
// doesn't depend on the RLS it guards.
export async function recipientCheck(admin: MarketingDb, emailId: string, orgId: string): Promise<{ deliveries: number, addresses: number, foreign: number } | null> {
  const r = await sql<{ deliveries: number, addresses: number, foreign: number }>`
    SELECT
      (SELECT count(*)::int FROM marketing_delivery WHERE email_id = ${emailId}) AS deliveries,
      (SELECT count(*)::int FROM crm_channels WHERE org_id = ${orgId} AND channel_type = 'email') AS addresses,
      (SELECT count(*)::int FROM marketing_delivery d LEFT JOIN crm_channels c ON c.id = d.channel_id
        WHERE d.email_id = ${emailId} AND (d.org_id <> ${orgId} OR c.org_id <> ${orgId})) AS foreign
  `.execute(admin)
  const row = r.rows[0]!
  return row.deliveries > row.addresses || row.foreign > 0 ? row : null
}

async function failEmail(tx: MarketingTx, emailId: string, reason: string, now: Date): Promise<void> {
  const res = await tx
    .updateTable('marketing_email')
    .set({ status: 'failed', failed_reason: reason, finished_at: now, updated_at: now })
    .where('id', '=', emailId)
    .where('status', 'in', ['scheduled', 'sending', 'paused'])
    .executeTakeFirst()
  if (!Number(res.numUpdatedRows)) return
  await tx
    .updateTable('marketing_delivery')
    .set({ status: 'skipped', skip_reason: reason, address: null, first_name: null })
    .where('email_id', '=', emailId)
    .where('status', '=', 'pending')
    .where('claimed_at', 'is', null)
    .execute()
  await recount(tx, emailId)
}

async function checkOrgGate(host: MarketingHost, tx: MarketingTx, orgId: string, now: Date): Promise<{ budget: number, paused: number, rate?: number }> {
  const since = new Date(now.getTime() - COMPLAINT_WINDOW_DAYS * 86_400_000)
  const complaints = await host.complaintCount(tx, orgId, since)
  if (complaints > 0) {
    const sent = await countSent(tx, since)
    const rate = complaints / Math.max(sent, COMPLAINT_MIN_VOLUME)
    if (rate >= (host.complaintPauseRate ?? COMPLAINT_PAUSE_RATE)) {
      const paused = await tx
        .updateTable('marketing_email')
        .set({ status: 'paused', paused_reason: 'complaint_rate', updated_at: now })
        .where('status', '=', 'sending')
        .executeTakeFirst()
      return { budget: 0, paused: Number(paused.numUpdatedRows), rate }
    }
  }
  const lastMinute = await countSent(tx, new Date(now.getTime() - 60_000))
  return { budget: Math.max(0, host.throttlePerMinute(orgId) - lastMinute), paused: 0 }
}

async function countSent(tx: MarketingTx, since: Date): Promise<number> {
  const row = await tx
    .selectFrom('marketing_delivery')
    .select(eb => eb.fn.countAll<string>().as('n'))
    .where('status', '=', 'sent')
    .where('sent_at', '>', since)
    .executeTakeFirstOrThrow()
  return Number(row.n)
}

// Claims up to `n` pending deliveries, re-checks consent and suppression
// (either may have changed since the email started) and renders the rest.
async function claimBatch(host: MarketingHost, tx: MarketingTx, orgId: string, emailId: string, n: number, now: Date): Promise<{ items: Claimed[], skipped: number }> {
  const email = await tx.selectFrom('marketing_email').select(['id', 'status', 'parent_id', 'versions', 'source_language']).where('id', '=', emailId).executeTakeFirst()
  if (!email || email.status !== 'sending') return { items: [], skipped: 0 }
  const claimed = await sql<{ id: string, channel_id: string | null, contact_id: string | null, address: string | null, first_name: string | null, language: string, purpose: string | null, attempts: number }>`
    WITH picked AS MATERIALIZED (
      SELECT id FROM marketing_delivery
      WHERE email_id = ${emailId} AND status = 'pending' AND claimed_at IS NULL
      ORDER BY id LIMIT ${n}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE marketing_delivery d SET claimed_at = ${now}, attempts = d.attempts + 1
    FROM picked WHERE d.id = picked.id
    RETURNING d.id, d.channel_id, d.contact_id, d.address, d.first_name, d.language, d.purpose, d.attempts
  `.execute(tx)
  const rows = claimed.rows
  if (!rows.length) return { items: [], skipped: 0 }

  const skip = new Map<string, string>()
  for (const r of rows) if (!r.address || !r.channel_id) skip.set(r.id, 'no_address')
  const purposes = new Set(rows.map(r => r.purpose).filter((p): p is string => !!p))
  for (const purpose of purposes) {
    const ids = rows.filter(r => r.purpose === purpose && r.channel_id).map(r => r.channel_id!)
    const ok = host.consentedAmong ? await host.consentedAmong(tx, ids, purpose) : await defaultConsentedAmong(tx, ids, purpose)
    for (const r of rows) if (r.purpose === purpose && r.channel_id && !ok.has(r.channel_id) && !skip.has(r.id)) skip.set(r.id, 'no_consent')
  }
  const suppressed = await host.suppressedAmong(tx, orgId, rows.filter(r => r.address).map(r => r.address!.trim().toLowerCase()))
  for (const r of rows) if (r.address && suppressed.has(r.address.trim().toLowerCase()) && !skip.has(r.id)) skip.set(r.id, 'suppressed')
  for (const [id, reason] of skip) {
    await tx.updateTable('marketing_delivery').set({ status: 'skipped', skip_reason: reason, claimed_at: null, address: null, first_name: null }).where('id', '=', id).execute()
  }
  if (skip.size) await recount(tx, emailId)

  const sender = await host.sender(tx, orgId)
  const secret = host.secret()
  const base = host.unsubscribeBaseUrl()
  const items: Claimed[] = []
  for (const r of rows) {
    if (skip.has(r.id)) continue
    const token = signToken({ o: orgId, d: r.id }, secret)
    const urls = unsubscribeUrls(base, token)
    const recipient = { contactId: r.contact_id, channelId: r.channel_id, address: r.address!, language: r.language, firstName: r.first_name }
    const rendered = await renderEmail(host, tx, orgId, email, r.language, recipient, { unsubscribeUrl: urls.page, test: false })
    items.push({
      id: r.id,
      attempts: r.attempts,
      mail: {
        to: r.address!,
        fromName: sender.fromName,
        fromLocal: sender.fromLocal,
        replyTo: sender.replyTo,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        unsubscribeUrl: urls.oneClick,
        orgId,
        ref: r.id
      }
    })
  }
  return { items, skipped: skip.size }
}

async function sendAll(host: MarketingHost, items: Claimed[], concurrency = 4): Promise<Outcome[]> {
  const out: Outcome[] = []
  let i = 0
  const worker = async () => {
    while (i < items.length) {
      const item = items[i++]!
      try {
        const res = await host.send(item.mail)
        out.push(res.status === 'suppressed'
          ? { id: item.id, attempts: item.attempts, skip: 'suppressed' }
          : { id: item.id, attempts: item.attempts, providerId: res.id })
      } catch (err) {
        const retryable = (err as { retryable?: boolean }).retryable !== false
        out.push({ id: item.id, attempts: item.attempts, error: String((err as Error)?.message ?? err).slice(0, 500), retryable })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return out
}

async function recordOutcomes(tx: MarketingTx, emailId: string, outcomes: Outcome[], now: Date): Promise<void> {
  for (const o of outcomes) {
    if (o.skip) {
      await tx.updateTable('marketing_delivery').set({ status: 'skipped', skip_reason: o.skip, claimed_at: null, address: null, first_name: null }).where('id', '=', o.id).execute()
    } else if (!o.error) {
      await tx.updateTable('marketing_delivery').set({ status: 'sent', sent_at: now, provider_id: o.providerId ?? null, claimed_at: null, error: null, address: null, first_name: null }).where('id', '=', o.id).execute()
    } else if (o.retryable && o.attempts < MAX_ATTEMPTS) {
      await tx.updateTable('marketing_delivery').set({ claimed_at: null, error: o.error }).where('id', '=', o.id).execute()
    } else {
      await tx.updateTable('marketing_delivery').set({ status: 'failed', error: o.error, claimed_at: null, address: null, first_name: null }).where('id', '=', o.id).execute()
    }
  }
  await recount(tx, emailId)
}

// ── Parents ─────────────────────────────────────────────────────────────────

// Combined results on each parent; a parent is sent once every site's email is
// sent, cancelled or failed.
async function syncParents(admin: MarketingDb, now: Date): Promise<void> {
  await sql`
    UPDATE marketing_parent p SET
      recipients = s.recipients, sent = s.sent, skipped = s.skipped, failed = s.failed,
      people = (SELECT count(*)::int FROM marketing_parent_recipient r WHERE r.parent_id = p.id),
      status = CASE WHEN p.status = 'sending' AND s.open = 0 THEN 'sent' ELSE p.status END,
      finished_at = CASE WHEN p.status = 'sending' AND s.open = 0 THEN ${now}::timestamptz ELSE p.finished_at END,
      updated_at = ${now}
    FROM (
      SELECT parent_id,
        sum(recipients)::int AS recipients, sum(sent)::int AS sent, sum(skipped)::int AS skipped, sum(failed)::int AS failed,
        count(*) FILTER (WHERE status NOT IN ('sent', 'cancelled', 'failed'))::int AS open
      FROM marketing_email WHERE parent_id IS NOT NULL GROUP BY parent_id
    ) s
    WHERE s.parent_id = p.id AND p.status IN ('sending', 'paused')
  `.execute(admin)
  // Unsubscribes keep arriving after a send finishes; each counts on the site
  // email it came from.
  await sql`
    UPDATE marketing_parent p SET unsubscribes = s.unsubscribes, updated_at = ${now}
    FROM (SELECT parent_id, sum(unsubscribes)::int AS unsubscribes FROM marketing_email WHERE parent_id IS NOT NULL GROUP BY parent_id) s
    WHERE s.parent_id = p.id AND p.unsubscribes <> s.unsubscribes
  `.execute(admin)
}

// ── Actions (admin app) ─────────────────────────────────────────────────────

export async function cancelEmail(tx: MarketingTx, emailId: string, now: Date = new Date()): Promise<boolean> {
  const res = await tx
    .updateTable('marketing_email')
    .set({ status: 'cancelled', finished_at: now, updated_at: now })
    .where('id', '=', emailId)
    .where('status', 'in', ['scheduled', 'sending', 'paused'])
    .executeTakeFirst()
  if (!Number(res.numUpdatedRows)) return false
  await tx
    .updateTable('marketing_delivery')
    .set({ status: 'skipped', skip_reason: 'cancelled', address: null, first_name: null })
    .where('email_id', '=', emailId)
    .where('status', '=', 'pending')
    .where('claimed_at', 'is', null)
    .execute()
  await recount(tx, emailId)
  return true
}

export async function pauseEmail(tx: MarketingTx, emailId: string, now: Date = new Date()): Promise<boolean> {
  const res = await tx
    .updateTable('marketing_email')
    .set({ status: 'paused', paused_reason: 'manual', updated_at: now })
    .where('id', '=', emailId)
    .where('status', '=', 'sending')
    .executeTakeFirst()
  return Number(res.numUpdatedRows) > 0
}

export async function resumeEmail(tx: MarketingTx, emailId: string, now: Date = new Date()): Promise<boolean> {
  const res = await tx
    .updateTable('marketing_email')
    .set({ status: 'sending', paused_reason: null, updated_at: now })
    .where('id', '=', emailId)
    .where('status', '=', 'paused')
    .executeTakeFirst()
  return Number(res.numUpdatedRows) > 0
}
