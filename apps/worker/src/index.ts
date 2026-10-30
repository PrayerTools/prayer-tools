// Worker entry: reminder sweep every minute, job queue every few seconds, scheduled jobs (croner, UTC).
// `bun src/index.ts --run <name>` runs one scheduled job (or `reminders`, `jobs`) once and exits.
import { Cron } from 'croner'
import { closeContext, createContext } from './context'
import { createLogger, runId } from './log'
import { captureException, pushHeartbeat } from './monitor'
import { runReminderSweep } from './reminders'
import { drainJobs, reapJobs } from './jobs/processor'
import { SCHEDULED_JOBS, runScheduled, scheduledJob } from './daily'
import { errorMessage } from './util'
import { runMarketing } from './marketing'
import { platformConfig } from '@prayertools/shared/config'

const REMINDER_INTERVAL_MS = Number(process.env.REMINDER_INTERVAL_MS) || 60_000
const JOB_INTERVAL_MS = Number(process.env.JOB_INTERVAL_MS) || 5_000
const REAP_INTERVAL_MS = 60_000
const MARKETING_INTERVAL_MS = Number(process.env.MARKETING_INTERVAL_MS) || 15_000
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 120_000

let stopping = false
// Fails at startup when required configuration is missing.
platformConfig()

const log = createLogger({ process: 'worker' })
const ctx = createContext({ log, stopping: () => stopping })
const inflight = new Set<Promise<unknown>>()

function track<T>(p: Promise<T>): Promise<T> {
  inflight.add(p)
  p.finally(() => inflight.delete(p)).catch(() => {})
  return p
}

async function reminderTick(): Promise<void> {
  const rlog = log.child({ run: runId(), job: 'reminders' })
  const started = Date.now()
  try {
    const res = await runReminderSweep(ctx, rlog)
    await pushHeartbeat(process.env.KUMA_PUSH_WORKER, 'up', `claimed ${res.claimed}, lag ${Math.round(res.lagMs / 1000)}s`, Date.now() - started)
  } catch (err) {
    rlog.error('reminders.sweep_failed', { err })
    await captureException(err, { job: 'reminders' })
    await pushHeartbeat(process.env.KUMA_PUSH_WORKER, 'down', errorMessage(err))
  }
}

async function jobTick(): Promise<void> {
  const jlog = log.child({ run: runId(), job: 'queue' })
  try {
    await drainJobs(ctx, jlog)
  } catch (err) {
    jlog.error('jobs.drain_failed', { err })
    await captureException(err, { job: 'queue' })
  }
}

async function marketingTick(): Promise<void> {
  const mlog = log.child({ run: runId(), job: 'marketing' })
  try {
    await runMarketing(ctx, mlog)
  } catch (err) {
    mlog.error('marketing.run_failed', { err })
    await captureException(err, { job: 'marketing' })
  }
}

async function reapTick(): Promise<void> {
  try {
    await reapJobs(ctx, log.child({ job: 'reap' }))
  } catch (err) {
    log.error('jobs.reap_failed', { err })
  }
}

// Runs `fn` every `ms`, never overlapping itself; the first run after `firstMs`.
function every(ms: number, firstMs: number, fn: () => Promise<void>): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const loop = async () => {
    if (stopping) return
    await track(fn())
    if (!stopping) timer = setTimeout(loop, ms)
  }
  timer = setTimeout(loop, firstMs)
  return () => {
    if (timer) clearTimeout(timer)
  }
}

async function runOnce(name: string): Promise<number> {
  const olog = log.child({ run: runId(), job: name, once: true })
  if (name === 'reminders') {
    olog.info('once.completed', { ...(await runReminderSweep(ctx, olog)) })
    return 0
  }
  if (name === 'marketing') {
    olog.info('once.completed', { ...(await runMarketing(ctx, olog)) })
    return 0
  }
  if (name === 'jobs') {
    olog.info('once.completed', { ran: await drainJobs(ctx, olog) })
    return 0
  }
  const job = scheduledJob(name)
  if (!job) {
    olog.error('once.unknown_job', { known: ['reminders', 'jobs', 'marketing', ...SCHEDULED_JOBS.map(j => j.name)] })
    return 1
  }
  olog.info('once.completed', { ...(await job.run(ctx, olog)) })
  return 0
}

async function main(): Promise<void> {
  const i = process.argv.indexOf('--run')
  if (i >= 0) {
    const name = process.argv[i + 1] ?? ''
    let code = 1
    try {
      code = await runOnce(name)
    } catch (err) {
      log.error('once.failed', { job: name, err })
    }
    await closeContext(ctx)
    process.exit(code)
  }

  log.info('worker.started', { scheduled: SCHEDULED_JOBS.map(j => `${j.name}@${j.cron}`) })
  const stops = [
    every(REMINDER_INTERVAL_MS, 2_000, reminderTick),
    every(JOB_INTERVAL_MS, 3_000, jobTick),
    every(REAP_INTERVAL_MS, 10_000, reapTick),
    every(MARKETING_INTERVAL_MS, 5_000, marketingTick)
  ]
  const crons = SCHEDULED_JOBS.map(job => new Cron(job.cron, { timezone: 'UTC', protect: true }, () => track(runScheduled(ctx, job, log))))

  const shutdown = async (signal: string) => {
    if (stopping) {
      log.warn('worker.forced_exit', { signal })
      process.exit(1)
    }
    stopping = true
    log.info('worker.stopping', { signal, inflight: inflight.size })
    for (const s of stops) s()
    for (const c of crons) c.stop()
    const timeout = new Promise(resolve => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS).unref())
    await Promise.race([Promise.allSettled([...inflight]), timeout])
    await closeContext(ctx)
    log.info('worker.stopped', { signal })
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('unhandledRejection', (err) => {
    log.error('worker.unhandled_rejection', { err })
    void captureException(err)
  })
}

await main()
