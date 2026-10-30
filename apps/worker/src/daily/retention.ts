// Data retention: per-org anonymization (12 months unsubscribed or archived), idle app devices,
// unused accounts, and platform-wide expiry of raw analytics, old session partitions, the email
// log, account codes and expired sign-ins on the admin connection.
import { sql } from 'kysely'
import { forEachOrg } from '@prayertools/shared/db/scope'
import { anonymizeSubscription } from '@prayertools/shared/subscriptions'
import { deleteAccountIfUnused } from '@prayertools/shared/accounts'
import type { WorkerContext } from '../context'
import type { Logger } from '../log'
import { DAY, groupBy } from '../util'

export const UNSUBSCRIBED_RETENTION_MONTHS = 12
export const ARCHIVED_RETENTION_MONTHS = 12
export const EVENT_RETENTION_DAYS = 90
export const VISITOR_DAY_RETENTION_DAYS = 7
export const SESSION_RETENTION_MONTHS = 24
export const DEVICE_IDLE_MONTHS = 12
const BATCH = 5000

function monthsAgo(now: Date, months: number): Date {
  const d = new Date(now)
  d.setUTCMonth(d.getUTCMonth() - months)
  return d
}

async function anonymize(ctx: WorkerContext, log: Logger, rows: { id: string, org_id: string }[], reason: string): Promise<number> {
  let n = 0
  const now = ctx.now()
  const byOrg = groupBy(rows, r => r.org_id)
  await forEachOrg(ctx.app, byOrg.keys(), async (tx, orgId) => {
    for (const { id } of byOrg.get(orgId) ?? []) {
      if (await anonymizeSubscription(tx, id, now)) n++
    }
  }, (orgId, err) => log.error('retention.anonymize_failed', { site: orgId, reason, err }))
  return n
}

export async function anonymizeUnsubscribed(ctx: WorkerContext, log: Logger): Promise<number> {
  const cutoff = monthsAgo(ctx.now(), UNSUBSCRIBED_RETENTION_MONTHS)
  const due = await sql<{ id: string, org_id: string }>`
    SELECT id::text AS id, org_id::text AS org_id FROM pt_subscription
    WHERE status = 'unsubscribed' AND anonymized_at IS NULL AND unsubscribed_at < ${cutoff}::timestamptz
    LIMIT ${BATCH}
  `.execute(ctx.admin)
  return await anonymize(ctx, log, due.rows, 'unsubscribed')
}

export async function anonymizeArchivedSites(ctx: WorkerContext, log: Logger): Promise<number> {
  const now = ctx.now()
  const cutoff = monthsAgo(now, ARCHIVED_RETENTION_MONTHS)
  const due = await sql<{ id: string, org_id: string }>`
    SELECT s.id::text AS id, s.org_id::text AS org_id
    FROM pt_subscription s JOIN pt_site st ON st.org_id = s.org_id
    WHERE st.status = 'archived' AND st.archived_at < ${cutoff}::timestamptz AND s.anonymized_at IS NULL
    LIMIT ${BATCH}
  `.execute(ctx.admin)
  const n = await anonymize(ctx, log, due.rows, 'archived_site')
  const done = await sql<{ org_id: string }>`
    SELECT st.org_id::text AS org_id FROM pt_site st
    WHERE st.status = 'archived' AND st.archived_at < ${cutoff}::timestamptz AND st.anonymized_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM pt_subscription s WHERE s.org_id = st.org_id AND s.anonymized_at IS NULL)
  `.execute(ctx.admin)
  await forEachOrg(ctx.app, done.rows.map(r => r.org_id), tx => tx.updateTable('pt_site').set({ anonymized_at: now }).execute(),
    (orgId, err) => log.error('retention.site_mark_failed', { site: orgId, err }))
  return n
}

// App devices not seen for a year are taken as uninstalled. An account left
// with no address and no device can never be reached again, so its app
// subscriptions let go of it (the rows stay, so campaign counts don't change)
// and deleteUnusedAccounts removes it.
export async function expireIdleDevices(ctx: WorkerContext, log: Logger): Promise<{ devices: number, released: number }> {
  const cutoff = monthsAgo(ctx.now(), DEVICE_IDLE_MONTHS)
  const devices = await deleteInBatches(ctx, async () => Number((await sql`
    DELETE FROM pt_user_device WHERE id IN (SELECT id FROM pt_user_device WHERE last_seen_at < ${cutoff}::timestamptz LIMIT ${BATCH})
  `.execute(ctx.admin)).numAffectedRows ?? 0))
  const due = await sql<{ id: string, org_id: string }>`
    SELECT s.id::text AS id, s.org_id::text AS org_id
    FROM pt_subscription s JOIN users u ON u.id = s.user_id
    WHERE u.email IS NULL AND NOT EXISTS (SELECT 1 FROM pt_user_device d WHERE d.user_id = u.id)
    LIMIT ${BATCH}
  `.execute(ctx.admin)
  let released = 0
  const byOrg = groupBy(due.rows, r => r.org_id)
  await forEachOrg(ctx.app, byOrg.keys(), async (tx, orgId) => {
    const ids = (byOrg.get(orgId) ?? []).map(r => r.id)
    const res = await tx.updateTable('pt_subscription').set({ user_id: null, updated_at: ctx.now() }).where('id', 'in', ids).executeTakeFirst()
    released += Number(res.numUpdatedRows)
  }, (orgId, err) => log.error('retention.device_release_failed', { site: orgId, err }))
  return { devices, released }
}

// On the admin connection: whether an account is unused spans every site.
export async function deleteUnusedAccounts(ctx: WorkerContext): Promise<number> {
  const graceCutoff = new Date(ctx.now().getTime() - DAY)
  const candidates = await sql<{ id: string }>`
    SELECT u.id::text AS id FROM users u
    WHERE u.created < ${graceCutoff}::timestamptz AND u.password IS NULL AND NOT u.is_admin
      AND NOT EXISTS (SELECT 1 FROM pt_subscription s WHERE s.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM crm_records r WHERE r.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM pt_user_device d WHERE d.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM user_identities i WHERE i.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM sessions se WHERE se.user_id = u.id AND se.expires_at > now())
    LIMIT ${BATCH}
  `.execute(ctx.admin)
  let n = 0
  for (const { id } of candidates.rows) {
    try {
      if (await ctx.admin.transaction().execute(tx => deleteAccountIfUnused(tx, id))) n++
    } catch {
      // Still referenced by a table outside prayer.tools (e.g. a record it created).
    }
  }
  return n
}

async function deleteInBatches(ctx: WorkerContext, statement: () => Promise<number>): Promise<number> {
  let total = 0
  for (let i = 0; i < 100 && !ctx.stopping(); i++) {
    const n = await statement()
    total += n
    if (n < BATCH) break
  }
  return total
}

export async function purgeRawAnalytics(ctx: WorkerContext): Promise<{ events: number, visitor_days: number }> {
  const now = ctx.now()
  const eventCutoff = new Date(now.getTime() - EVENT_RETENTION_DAYS * DAY)
  const visitorCutoff = new Date(now.getTime() - VISITOR_DAY_RETENTION_DAYS * DAY).toISOString().slice(0, 10)
  const events = await deleteInBatches(ctx, async () => Number((await sql`
    DELETE FROM pt_event WHERE id IN (SELECT id FROM pt_event WHERE created_at < ${eventCutoff}::timestamptz LIMIT ${BATCH})
  `.execute(ctx.admin)).numAffectedRows ?? 0))
  const visitorDays = await deleteInBatches(ctx, async () => Number((await sql`
    DELETE FROM pt_stat_visitor_day WHERE ctid IN (SELECT ctid FROM pt_stat_visitor_day WHERE day < ${visitorCutoff}::date LIMIT ${BATCH})
  `.execute(ctx.admin)).numAffectedRows ?? 0))
  return { events, visitor_days: visitorDays }
}

export function partitionCutoff(now: Date, months = SESSION_RETENTION_MONTHS): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  d.setUTCMonth(d.getUTCMonth() - months)
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// Monthly partitions wholly older than 24 months are dropped; upcoming months
// are created ahead of time.
export async function maintainSessionPartitions(ctx: WorkerContext, log: Logger): Promise<{ dropped: number }> {
  const cutoff = partitionCutoff(ctx.now())
  const parts = await sql<{ name: string }>`
    SELECT c.relname AS name FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = 'pt_prayer_session'::regclass AND c.relname ~ '^pt_prayer_session_[0-9]{6}$'
  `.execute(ctx.admin)
  let dropped = 0
  for (const { name } of parts.rows) {
    if (name.slice(-6) >= cutoff) continue
    await sql`DROP TABLE IF EXISTS ${sql.table(name)}`.execute(ctx.admin)
    dropped++
    log.info('retention.partition_dropped', { partition: name })
  }
  await sql`SELECT pt_ensure_session_partitions(2)`.execute(ctx.admin)
  return { dropped }
}

// The per-person email log is kept as long as prayer sessions.
export async function purgeEmailLog(ctx: WorkerContext): Promise<number> {
  const cutoff = monthsAgo(ctx.now(), SESSION_RETENTION_MONTHS)
  return await deleteInBatches(ctx, async () => Number((await sql`
    DELETE FROM pt_email_log WHERE id IN (SELECT id FROM pt_email_log WHERE sent_at < ${cutoff}::timestamptz LIMIT ${BATCH})
  `.execute(ctx.admin)).numAffectedRows ?? 0))
}

export async function purgeAuthCodes(ctx: WorkerContext): Promise<{ codes: number, sessions: number }> {
  const now = ctx.now()
  const codes = await ctx.admin.deleteFrom('pt_auth_code').where('expires_at', '<', new Date(now.getTime() - DAY)).executeTakeFirst()
  const sessions = await ctx.admin.deleteFrom('pt_account_session').where('expires_at', '<', now).executeTakeFirst()
  return { codes: Number(codes.numDeletedRows ?? 0), sessions: Number(sessions.numDeletedRows ?? 0) }
}

// Prayer times the signup form asked for that nobody confirmed in time.
export async function purgeSignupRequests(ctx: WorkerContext): Promise<number> {
  const res = await ctx.admin.deleteFrom('pt_signup_request').where('expires_at', '<', ctx.now()).executeTakeFirst()
  return Number(res.numDeletedRows ?? 0)
}

export async function runRetention(ctx: WorkerContext, log: Logger): Promise<Record<string, number>> {
  const unsubscribed = await anonymizeUnsubscribed(ctx, log)
  const archived = await anonymizeArchivedSites(ctx, log)
  const idle = await expireIdleDevices(ctx, log)
  const accounts = await deleteUnusedAccounts(ctx)
  const raw = await purgeRawAnalytics(ctx)
  const parts = await maintainSessionPartitions(ctx, log)
  const emails = await purgeEmailLog(ctx)
  const codes = await purgeAuthCodes(ctx)
  const requests = await purgeSignupRequests(ctx)
  return {
    anonymized_unsubscribed: unsubscribed,
    anonymized_archived: archived,
    devices_expired: idle.devices,
    app_subscriptions_released: idle.released,
    accounts_deleted: accounts,
    events_deleted: raw.events,
    visitor_days_deleted: raw.visitor_days,
    partitions_dropped: parts.dropped,
    email_log_deleted: emails,
    auth_codes_deleted: codes.codes,
    sessions_deleted: codes.sessions,
    signup_requests_deleted: requests
  }
}
