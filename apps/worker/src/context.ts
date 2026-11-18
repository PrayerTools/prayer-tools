// Passed to every sweep, job and scheduled job. `admin` (BYPASSRLS) is for set-based
// reads across sites and global tables; `app` (RLS) for every site write, inside `withOrg`.
import { createDb } from '@prayertools/shared/db/connect'
import type { Db } from '@prayertools/shared/db/scope'
import postgres from 'postgres'
import { createPtMail, failure, providePtMail, type Mail, type OutgoingMail, type SendResult } from '@prayertools/shared/email/mail'
import { hostnameStatus, type HostnameStatus } from '@prayertools/shared/cloudflare'
import { createLogger, type Logger } from './log'
import { oneSignalSender, type PushSender } from './push'

export interface WorkerContext {
  admin: Db
  app: Db
  log: Logger
  // The sending mail kernel, on the admin connection.
  mail: Mail
  // One send; throws when the mail neither went out nor was suppressed.
  sendMail: (mail: OutgoingMail) => Promise<SendResult>
  push: PushSender | null
  hostnameStatus: (hostname: string, id: string | null) => Promise<HostnameStatus>
  now: () => Date
  // True once shutdown began; long work checks it between batches.
  stopping: () => boolean
}

export function createContext(overrides: Partial<WorkerContext> = {}): WorkerContext {
  const adminUrl = process.env.DATABASE_URL
  const appUrl = process.env.APP_DATABASE_URL
  if (!overrides.admin && !adminUrl) throw new Error('DATABASE_URL is required')
  if (!overrides.app && !appUrl) throw new Error('APP_DATABASE_URL is required')
  const admin = overrides.admin ?? createDb(adminUrl!, { max: Number(process.env.DB_POOL_ADMIN || 8) })
  const log = overrides.log ?? createLogger({ process: 'worker' })
  const mail = overrides.mail ?? workerMail(admin, log)
  providePtMail(async () => mail)
  return {
    admin,
    app: overrides.app ?? createDb(appUrl!, { max: Number(process.env.DB_POOL_APP || 15) }),
    log,
    mail,
    sendMail: overrides.sendMail ?? (async (m) => {
      const res = await mail.send(m)
      const err = failure(res)
      if (err) throw err
      return res
    }),
    push: overrides.push !== undefined ? overrides.push : oneSignalSender(),
    hostnameStatus: overrides.hostnameStatus ?? hostnameStatus,
    now: overrides.now ?? (() => new Date()),
    stopping: overrides.stopping ?? (() => false)
  }
}

// Sends with the admin app's NUXT_SECRET_ENCRYPTION_KEY and the same env
// account variables. MAIL_LISTEN_DATABASE_URL, a direct connection (LISTEN
// can't go through PgBouncer), wakes the sender on every enqueue; otherwise
// the sweep runs every MAIL_SWEEP_SECONDS.
let listener: postgres.Sql | null = null
function workerMail(admin: Db, log: Logger): Mail {
  const listenUrl = process.env.MAIL_LISTEN_DATABASE_URL
  return createPtMail({
    db: admin,
    secretKey: process.env.NUXT_SECRET_ENCRYPTION_KEY,
    sweepSeconds: Number(process.env.MAIL_SWEEP_SECONDS) || 10,
    log: line => log.info('mail', { line }),
    subscribe: listenUrl
      ? (channel, onNotify) => {
          listener = postgres(listenUrl, { max: 1 })
          void listener.listen(channel, () => onNotify())
        }
      : undefined
  })
}

export async function closeContext(ctx: WorkerContext): Promise<void> {
  await ctx.mail.stop()
  await Promise.allSettled([ctx.admin.destroy(), ctx.app.destroy(), listener?.end({ timeout: 2 })])
}
