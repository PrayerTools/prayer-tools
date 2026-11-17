// Postgres job queue for fan-out work (end-of-campaign emails, marketing
// sends, exports). Claims use FOR UPDATE SKIP LOCKED so several workers never
// take the same job; a job stranded in `processing` by a crash is reaped
// back to `pending` after a timeout.
import { sql } from 'kysely'
import type { Db, Tx } from './db/scope'

export type JobType =
  | 'thank_you'
  | 'thank_you_person'
  | 'checkin_email'
  | 'site_email'
  | 'marketing_parent'
  | 'domain_alert'
  | 'export'
  | 'push_announcement'
  | 'help_request_alert'

export interface EnqueueOptions {
  orgId?: string | null
  referenceType?: string
  referenceId?: string
  priority?: number
  scheduledAt?: Date
  maxAttempts?: number
}

export interface Job {
  id: string
  type: string
  org_id: string | null
  reference_type: string | null
  reference_id: string | null
  payload: Record<string, unknown>
  attempts: number
  max_attempts: number
}

// Enqueue a job. With a reference, a second enqueue while one is still
// pending or processing is a no-op.
export async function enqueue(db: Db | Tx, type: JobType, payload: Record<string, unknown>, opts: EnqueueOptions = {}): Promise<string | null> {
  const row = await db
    .insertInto('pt_job')
    .values({
      type,
      org_id: opts.orgId ?? null,
      reference_type: opts.referenceType ?? null,
      reference_id: opts.referenceId ?? null,
      payload: sql`${JSON.stringify(payload)}::text::jsonb`,
      priority: opts.priority ?? 0,
      scheduled_at: opts.scheduledAt ?? new Date(),
      max_attempts: opts.maxAttempts ?? 3
    })
    .onConflict(oc => oc.doNothing())
    .returning('id')
    .executeTakeFirst()
  return row?.id ?? null
}

export async function claimJobs(db: Db, limit = 10, types?: string[]): Promise<Job[]> {
  const typeFilter = types?.length ? sql`AND type IN (${sql.join(types)})` : sql``
  const res = await sql<Job>`
    UPDATE pt_job
    SET status = 'processing', attempts = attempts + 1, last_attempt_at = now(), updated_at = now()
    WHERE id IN (
      SELECT id FROM pt_job
      WHERE status = 'pending' AND scheduled_at <= now() ${typeFilter}
      ORDER BY priority DESC, scheduled_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id::text, type, org_id, reference_type, reference_id, payload, attempts, max_attempts
  `.execute(db)
  return res.rows
}

export async function completeJob(db: Db, id: string, result?: Record<string, unknown>): Promise<void> {
  await db
    .updateTable('pt_job')
    .set({
      status: 'completed',
      result: result ? sql`${JSON.stringify(result)}::text::jsonb` : null,
      completed_at: new Date(),
      updated_at: new Date(),
      error_message: null
    })
    .where('id', '=', id)
    .execute()
}

// Re-queue with backoff while attempts remain, else mark failed.
export async function failJob(db: Db, job: Job, error: string, retryable = true): Promise<void> {
  const retry = retryable && job.attempts < job.max_attempts
  await db
    .updateTable('pt_job')
    .set({
      status: retry ? 'pending' : 'failed',
      error_message: error.slice(0, 1000),
      scheduled_at: retry ? new Date(Date.now() + 60_000 * 2 ** job.attempts) : undefined,
      updated_at: new Date()
    })
    .where('id', '=', job.id)
    .execute()
}

export async function reapStaleJobs(db: Db, timeoutMinutes = 15): Promise<number> {
  const res = await sql`
    UPDATE pt_job
    SET status = CASE WHEN attempts < max_attempts THEN 'pending' ELSE 'failed' END,
        error_message = CASE WHEN attempts < max_attempts THEN error_message ELSE coalesce(error_message, 'Stalled in processing') END,
        updated_at = now()
    WHERE status = 'processing' AND last_attempt_at < now() - make_interval(mins => ${timeoutMinutes})
  `.execute(db)
  return Number(res.numAffectedRows ?? 0)
}

export async function retryJob(db: Db, id: string): Promise<void> {
  await db
    .updateTable('pt_job')
    .set({ status: 'pending', attempts: 0, error_message: null, scheduled_at: new Date(), updated_at: new Date() })
    .where('id', '=', id)
    .where('status', '=', 'failed')
    .execute()
}

// Stores a long job's progress in `result` so a retry resumes there; refreshing
// `last_attempt_at` keeps a live job from being reaped as stale.
export async function saveJobProgress(db: Db | Tx, id: string, progress: Record<string, unknown>): Promise<void> {
  await db
    .updateTable('pt_job')
    .set({ result: sql`${JSON.stringify(progress)}::text::jsonb`, last_attempt_at: new Date(), updated_at: new Date() })
    .where('id', '=', id)
    .execute()
}

export async function jobProgress<T extends Record<string, unknown>>(db: Db | Tx, id: string): Promise<Partial<T>> {
  const row = await db.selectFrom('pt_job').select('result').where('id', '=', id).executeTakeFirst()
  return (row?.result ?? {}) as Partial<T>
}

// Requeues a claimed job without counting the attempt (shutdown mid-job).
export async function releaseJob(db: Db, id: string, delayMs = 0): Promise<void> {
  await db
    .updateTable('pt_job')
    .set(eb => ({
      status: 'pending',
      attempts: sql`greatest(${eb.ref('attempts')} - 1, 0)`,
      scheduled_at: new Date(Date.now() + delayMs),
      updated_at: new Date()
    }))
    .where('id', '=', id)
    .where('status', '=', 'processing')
    .execute()
}
