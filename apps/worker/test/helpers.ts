// Test fixtures: sites, campaigns and subscribers with unique slugs, a worker
// context with captured mail, and cleanup that removes everything a test made.
import { randomBytes } from 'node:crypto'
import { sql } from 'kysely'
import { createDb } from '@prayertools/shared/db/connect'
import { withOrg, type Db } from '@prayertools/shared/db/scope'
import { jsonb } from '@prayertools/shared/db/json'
import { ensureSystemUser } from '@prayertools/shared/crm'
import { createWebSignup } from '@prayertools/shared/subscriptions'
import type { OutgoingMail } from '@prayertools/shared/email/transport'
import type { CampaignCta, EndMode, Goal, StartMode, SubscriptionStatus, TranslatableText } from '@prayertools/shared/db/schema'
import { createContext, type WorkerContext } from '../src/context'
import { createLogger, type Fields } from '../src/log'

export const ADMIN_URL = process.env.DATABASE_URL!
export const APP_URL = process.env.APP_DATABASE_URL!

export interface TestEnv {
  admin: Db
  app: Db
  orgs: string[]
  intercessors: string[]
  emails: string[]
  users: string[]
}

export function testEnv(adminOpts: Parameters<typeof createDb>[1] = {}): TestEnv {
  return { admin: createDb(ADMIN_URL, { max: 5, ...adminOpts }), app: createDb(APP_URL, { max: 10 }), orgs: [], intercessors: [], emails: [], users: [] }
}

export interface TestCtx extends WorkerContext {
  mails: OutgoingMail[]
  logs: Fields[]
  setNow: (d: Date) => void
}

export function testCtx(env: TestEnv, overrides: Partial<WorkerContext> = {}): TestCtx {
  const mails: OutgoingMail[] = []
  const logs: Fields[] = []
  let now: Date | null = null
  const ctx = createContext({
    admin: env.admin,
    app: env.app,
    log: createLogger({}, line => logs.push(line), 'debug'),
    sendMail: async (m) => {
      mails.push(m)
      return { id: null }
    },
    push: null,
    now: () => now ?? new Date(),
    ...overrides
  })
  return Object.assign(ctx, { mails, logs, setNow: (d: Date) => { now = d } })
}

export function uid(): string {
  return randomBytes(4).toString('hex')
}

export function testEmail(env: TestEnv, label = 'p'): string {
  const e = `${label}-${uid()}@test.example`
  env.emails.push(e)
  return e
}

export interface SiteOpts {
  status?: 'draft' | 'published' | 'archived'
  languages?: string[]
  timezone?: string
  settings?: Record<string, unknown>
  archivedAt?: Date
}

export async function createSite(env: TestEnv, opts: SiteOpts = {}): Promise<{ orgId: string, slug: string }> {
  await ensureSystemUser(env.admin)
  const slug = `t-${uid()}`
  const org = await env.admin.insertInto('orgs').values({ slug, name: `Test ${slug}`, created_at: new Date(), updated_at: new Date() }).returning('id').executeTakeFirstOrThrow()
  env.orgs.push(org.id)
  const languages = opts.languages ?? ['en']
  await withOrg(env.admin, org.id, tx => tx.insertInto('pt_site').values({
    org_id: org.id,
    status: opts.status ?? 'published',
    languages: sql`${`{${languages.join(',')}}`}::text[]`,
    default_language: languages[0]!,
    timezone: opts.timezone ?? 'America/New_York',
    settings: jsonb(opts.settings ?? {}),
    email_identity: jsonb({ reply_to: 'champion@test.example' }),
    archived_at: opts.archivedAt ?? null
  }).execute())
  return { orgId: org.id, slug }
}

export interface CampaignOpts {
  name?: string
  startMode?: StartMode
  startDate?: string | null
  endMode?: EndMode
  endDate?: string | null
  lengthDays?: number | null
  goal?: Goal
  timezone?: string
  endMessage?: TranslatableText
  cta?: CampaignCta
  kind?: 'side' | null
  // A draft campaign when false.
  published?: boolean
}

export async function createCampaign(env: TestEnv, orgId: string, o: CampaignOpts = {}): Promise<string> {
  const startMode = o.startMode ?? 'date'
  const row = await withOrg(env.admin, orgId, tx => tx.insertInto('pt_campaign').values({
    slug: `c${uid()}`,
    name: o.name ?? 'Test campaign',
    start_mode: startMode,
    start_date: startMode === 'join' ? null : (o.startDate ?? '2026-01-01'),
    end_mode: o.endMode ?? 'date',
    end_date: o.endMode === 'none' || o.endMode === 'days' ? null : (o.endDate ?? '2026-01-20'),
    length_days: o.lengthDays ?? null,
    goal: o.goal ?? 'people',
    cadence: 'daily',
    timezone: o.timezone ?? 'America/New_York',
    end_message: o.endMessage ? jsonb(o.endMessage) : null,
    cta: jsonb(o.cta ?? {}),
    kind: o.kind ?? null,
    published_at: o.published === false ? null : new Date()
  }).returning('id').executeTakeFirstOrThrow())
  return row.id
}

export interface SubscriberOpts {
  email?: string
  verified?: boolean
  language?: string
  status?: SubscriptionStatus
  createdAt?: Date
  lastActivityAt?: Date | null
  cycleStartedAt?: Date | null
}

export async function createSubscriber(env: TestEnv, orgId: string, campaignId: string, o: SubscriberOpts = {}): Promise<{ subscriptionId: string, email: string, contactId: string }> {
  const email = o.email ?? testEmail(env)
  return await withOrg(env.admin, orgId, async (tx) => {
    const campaign = await tx.selectFrom('pt_campaign').selectAll().where('id', '=', campaignId).executeTakeFirstOrThrow()
    const res = await createWebSignup(tx, {
      campaign,
      email,
      name: 'Test Person',
      language: o.language ?? 'en',
      timezone: 'America/New_York',
      commitments: [],
      consents: {},
      answers: { pt_church: 'Grace' },
      preVerified: o.verified ?? true,
      capture: { surface: 'test', source: 'test' }
    })
    if (res.subscription.intercessor_id) env.intercessors.push(res.subscription.intercessor_id)
    const patch = {
      ...(o.status ? { status: o.status, unsubscribed_at: o.status === 'unsubscribed' ? new Date() : null } : {}),
      ...(o.createdAt ? { created_at: o.createdAt } : {}),
      ...(o.lastActivityAt !== undefined ? { last_activity_at: o.lastActivityAt } : {}),
      ...(o.cycleStartedAt !== undefined ? { checkin_cycle_started_at: o.cycleStartedAt } : {})
    }
    if (Object.keys(patch).length) await tx.updateTable('pt_subscription').set(patch).where('id', '=', res.subscription.id).execute()
    return { subscriptionId: res.subscription.id, email, contactId: res.contactId }
  })
}

export interface CommitmentOpts {
  time?: string
  timezone?: string
  startsOn: string
  endsOn?: string | null
  next?: Date | null
  durationMin?: number | null
  entriesDone?: number
  advancedOn?: string | null
}

export async function addCommitment(env: TestEnv, orgId: string, subscriptionId: string, campaignId: string, o: CommitmentOpts): Promise<string> {
  const row = await withOrg(env.admin, orgId, tx => tx.insertInto('pt_commitment').values({
    subscription_id: subscriptionId,
    campaign_id: campaignId,
    kind: 'recurring',
    frequency: 'daily',
    time: o.time ?? '07:00',
    timezone: o.timezone ?? 'America/New_York',
    duration_min: o.durationMin ?? null,
    starts_on: o.startsOn,
    ends_on: o.endsOn ?? null,
    next_reminder_utc: o.next ?? null,
    entries_done: o.entriesDone ?? 0,
    advanced_on: o.advancedOn ?? null
  }).returning('id').executeTakeFirstOrThrow())
  return row.id
}

export async function cleanup(env: TestEnv): Promise<void> {
  if (env.orgs.length) {
    const subs = await env.admin.selectFrom('pt_subscription').select('intercessor_id').where('org_id', 'in', env.orgs).where('intercessor_id', 'is not', null).execute()
    env.intercessors.push(...subs.map(s => s.intercessor_id!))
    await env.admin.deleteFrom('orgs').where('id', 'in', env.orgs).execute()
  }
  if (env.intercessors.length) await env.admin.deleteFrom('pt_intercessor').where('id', 'in', env.intercessors).execute()
  if (env.emails.length) await env.admin.deleteFrom('pt_intercessor').where(eb => eb.fn('lower', ['email']), 'in', env.emails.map(e => e.toLowerCase())).execute()
  if (env.users.length) await env.admin.deleteFrom('users').where('id', 'in', env.users).execute()
  env.orgs = []
  env.intercessors = []
  env.emails = []
  env.users = []
}

export async function closeEnv(env: TestEnv): Promise<void> {
  await cleanup(env)
  await env.admin.destroy()
  await env.app.destroy()
}

export function mailsTo(mails: OutgoingMail[], email: string): OutgoingMail[] {
  return mails.filter(m => m.to === email)
}

// Due jobs of this test's sites become due now (retries are scheduled later).
export async function makeJobsDue(env: TestEnv): Promise<void> {
  if (env.orgs.length) await env.admin.updateTable('pt_job').set({ scheduled_at: new Date(Date.now() - 1000) }).where('org_id', 'in', env.orgs).where('status', '=', 'pending').execute()
}
