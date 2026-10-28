// Scheduled jobs (croner, UTC), idempotent and runnable with `--run <name>`. Jobs that depend on
// a local date in some timezone run hourly so they land within an hour of local midnight.
import { sql } from 'kysely'
import type { WorkerContext } from '../context'
import { runId, type Logger } from '../log'
import { captureException, dailyHeartbeatUrl, pushHeartbeat } from '../monitor'
import { errorMessage } from '../util'
import { reapJobs } from '../jobs/processor'
import { closeEndedCampaigns, completePersonalStart } from './campaigns'
import { appInactivity, deleteUnverified } from './subscriptions'
import { runCheckins } from './checkins'
import { refreshStats } from './stats'
import { checkDomains } from './domains'
import { runRetention } from './retention'
import { syncLinkedContacts } from './accounts'

export interface ScheduledJob {
  name: string
  cron: string
  run: (ctx: WorkerContext, log: Logger) => Promise<Record<string, number>>
}

export const SCHEDULED_JOBS: readonly ScheduledJob[] = [
  { name: 'close_campaigns', cron: '5 * * * *', run: closeEndedCampaigns },
  { name: 'personal_completion', cron: '10 * * * *', run: completePersonalStart },
  { name: 'checkins', cron: '20 * * * *', run: runCheckins },
  { name: 'unverified_cleanup', cron: '30 2 * * *', run: deleteUnverified },
  { name: 'app_inactivity', cron: '40 2 * * *', run: appInactivity },
  { name: 'stats_refresh', cron: '0 3 * * *', run: refreshStats },
  { name: 'domains', cron: '30 3 * * *', run: checkDomains },
  { name: 'account_sync', cron: '45 3 * * *', run: syncLinkedContacts },
  { name: 'retention', cron: '0 4 * * *', run: runRetention },
  { name: 'reap_jobs', cron: '15 4 * * *', run: async (ctx, log) => ({ reaped: await reapJobs(ctx, log) }) }
]

export function scheduledJob(name: string): ScheduledJob | undefined {
  return SCHEDULED_JOBS.find(j => j.name === name)
}

// One run of a scheduled job at a time across worker instances: a
// transaction-scoped advisory lock held for the job's duration.
async function withJobLock<T>(c: WorkerContext, name: string, fn: () => Promise<T>): Promise<{ ran: true, value: T } | { ran: false }> {
  return await c.admin.transaction().execute(async (tx) => {
    const got = await sql<{ ok: boolean }>`select pg_try_advisory_xact_lock(hashtext(${`pt-worker:${name}`})) as ok`.execute(tx)
    if (!got.rows[0]?.ok) return { ran: false as const }
    return { ran: true as const, value: await fn() }
  })
}

export async function runScheduled(c: WorkerContext, job: ScheduledJob, base: Logger): Promise<void> {
  const jlog = base.child({ run: runId(), job: job.name })
  const started = Date.now()
  const heartbeat = dailyHeartbeatUrl(job.name)
  try {
    const res = await withJobLock(c, job.name, () => job.run(c, jlog))
    if (!res.ran) {
      jlog.info('scheduled.skipped', { reason: 'running elsewhere' })
      return
    }
    jlog.info('scheduled.completed', { ms: Date.now() - started, ...res.value })
    await pushHeartbeat(heartbeat, 'up', 'OK', Date.now() - started)
  } catch (err) {
    jlog.error('scheduled.failed', { ms: Date.now() - started, err })
    await captureException(err, { job: job.name })
    await pushHeartbeat(heartbeat, 'down', errorMessage(err))
  }
}

