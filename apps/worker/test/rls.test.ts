import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'kysely'
import { withOrg } from '@prayertools/shared/db/scope'
import { addDays, todayIn } from '@prayertools/shared/dates'
import { SCHEDULED_JOBS } from '../src/daily'
import { drainJobs } from '../src/jobs/processor'
import { runReminderSweep } from '../src/reminders'
import { runMarketing } from '../src/marketing'
import { asUser } from '../../admin/apps/marketing/lib/db'
import { scheduleParent } from '../../admin/apps/marketing/lib/multi'
import { jsonb } from '@prayertools/shared/db/json'
import { addCommitment, cleanup, closeEnv, createCampaign, createSite, createSubscriber, testCtx, testEnv, type TestEnv } from './helpers'
import { DAY } from '../src/util'

// Tables the admin (BYPASSRLS) connection may write: global tables, the
// reminder claim stamp, and platform-wide expiry of raw analytics.
const ADMIN_WRITABLE = new Set([
  'pt_job', 'pt_site_domain', 'users', 'pt_auth_code', 'sessions',
  'pt_event', 'pt_stat_visitor_day', 'pt_commitment', 'pt_email_log', 'pt_signup_request'
])

const queries: string[] = []
let env: TestEnv
beforeAll(() => { env = testEnv({ debug: (_c: number, q: string) => { queries.push(q) } } as never) })
afterEach(async () => { await cleanup(env) })
afterAll(async () => { await closeEnv(env) })

function writesIn(q: string): string[] {
  const out: string[] = []
  for (const m of q.matchAll(/(?<!for\s+)\b(insert\s+into|update|delete\s+from)\s+"?([a-z_0-9]+)"?/gi)) out.push(m[2]!.toLowerCase())
  return out
}

describe('connections', () => {
  it('the app connection is the RLS role and sees only the current org', async () => {
    const a = await createSite(env)
    const b = await createSite(env)
    await createCampaign(env, a.orgId)
    await createCampaign(env, b.orgId)
    const who = await sql<{ u: string, bypass: boolean }>`select current_user as u, rolbypassrls as bypass from pg_roles where rolname = current_user`.execute(env.app)
    expect(who.rows[0]).toEqual({ u: 'pt2_app', bypass: false })
    const seen = await withOrg(env.app, a.orgId, tx => tx.selectFrom('pt_campaign').select('org_id').execute())
    expect(new Set(seen.map(r => r.org_id))).toEqual(new Set([a.orgId]))
    const outside = await env.app.selectFrom('pt_campaign').select('id').execute()
    expect(outside).toHaveLength(0)
  })

  it('every write of site data goes through the RLS connection', async () => {
    const { orgId } = await createSite(env)
    const today = todayIn('America/New_York')
    const ended = await createCampaign(env, orgId, { startDate: addDays(today, -10), endDate: addDays(today, -1) })
    const ongoing = await createCampaign(env, orgId, { startDate: addDays(today, -100), endMode: 'none' })
    const quiet = new Date(Date.now() - 40 * DAY)
    const a = await createSubscriber(env, orgId, ended)
    await addCommitment(env, orgId, a.subscriptionId, ended, { startsOn: addDays(today, -10), endsOn: addDays(today, -1) })
    const b = await createSubscriber(env, orgId, ongoing, { createdAt: quiet, lastActivityAt: quiet, cycleStartedAt: quiet })
    await addCommitment(env, orgId, b.subscriptionId, ongoing, { startsOn: addDays(today, -100), next: new Date(Date.now() - 60_000) })
    await createSubscriber(env, orgId, ongoing, { verified: false, createdAt: new Date(Date.now() - 9 * DAY) })
    await withOrg(env.admin, orgId, tx => tx.updateTable('pt_subscription').set({ status: 'unsubscribed', unsubscribed_at: new Date(Date.now() - 400 * DAY) }).where('id', '=', a.subscriptionId).execute())

    queries.length = 0
    const ctx = testCtx(env)
    await runReminderSweep(ctx, ctx.log)
    for (const job of SCHEDULED_JOBS) await job.run(ctx, ctx.log)
    await drainJobs(ctx, ctx.log)
    expect(ctx.mails.length).toBeGreaterThanOrEqual(2)

    const written = new Set(queries.flatMap(writesIn))
    expect(written.has('pt_job')).toBe(true)
    const outside = [...written].filter(t => !ADMIN_WRITABLE.has(t))
    expect(outside).toEqual([])
    // The only admin write to pt_commitment is the claim stamp.
    const commitmentWrites = queries.filter(q => writesIn(q).includes('pt_commitment'))
    expect(commitmentWrites.every(q => /SET claimed_at = \$\d+::timestamptz\s+FROM due/.test(q))).toBe(true)
  })
})

describe('marketing', () => {
  it('the admin connection only finds work, reaps stale claims and totals sends; it never adds or widens deliveries', async () => {
    const a = await createSite(env)
    const b = await createSite(env)
    for (const site of [a, b]) {
      const campaign = await createCampaign(env, site.orgId, { endMode: 'none' })
      await createSubscriber(env, site.orgId, campaign)
    }
    const versions = jsonb({ en: { subject: 'Hi', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'News' }] }] } } })
    await withOrg(env.app, a.orgId, tx => sql`
      INSERT INTO marketing_email (versions, source_language, audiences, status, scheduled_at)
      VALUES (${versions}, 'en', '{current_campaign}', 'scheduled', now() - interval '1 minute')
    `.execute(tx))
    const user = await env.admin.insertInto('users').values({ email: `u-${Date.now()}@test.example`, display_name: 'Champion', created: new Date(), updated: new Date() }).returning('id').executeTakeFirstOrThrow()
    env.users.push(user.id)
    const parent = await sql<{ id: string }>`
      INSERT INTO marketing_parent (owner_user_id, versions, source_language, org_ids, audiences)
      VALUES (${user.id}, ${versions}, 'en', ${`{${a.orgId},${b.orgId}}`}::uuid[], '{current_campaign}') RETURNING id
    `.execute(env.admin)
    await asUser(env.app as never, user.id, tx => scheduleParent(tx, parent.rows[0]!.id, user.id, new Date(Date.now() - 60_000)))
    // A delivery claimed by a crashed pass long ago.
    await withOrg(env.app, b.orgId, async (tx) => {
      const email = await sql<{ id: string }>`
        INSERT INTO marketing_email (versions, source_language, audiences, status, started_at)
        VALUES (${versions}, 'en', '{current_campaign}', 'sending', now()) RETURNING id
      `.execute(tx)
      await sql`
        INSERT INTO marketing_delivery (email_id, address, language, status, claimed_at)
        VALUES (${email.rows[0]!.id}, 'stale@test.example', 'en', 'pending', now() - interval '1 hour')
      `.execute(tx)
    })

    queries.length = 0
    const ctx = testCtx(env)
    await runMarketing(ctx, ctx.log)
    await runMarketing(ctx, ctx.log)

    const marketing = queries.filter(q => writesIn(q).some(t => t.startsWith('marketing_')))
    expect(marketing.length).toBeGreaterThan(0)
    expect(marketing.filter(q => /\binsert\s+into\b/i.test(q))).toEqual([])
    const tables = new Set(marketing.flatMap(writesIn).filter(t => t.startsWith('marketing_')))
    expect([...tables].sort()).toEqual(['marketing_delivery', 'marketing_email', 'marketing_parent'])
    // Admin writes to deliveries are the reap: a stale pending claim becomes failed.
    const deliveryWrites = marketing.filter(q => writesIn(q).includes('marketing_delivery'))
    expect(deliveryWrites.every(q => /"status" = \$\d+/.test(q) && /"claimed_at" < \$\d+/.test(q))).toBe(true)
    const reaped = await withOrg(env.app, b.orgId, tx => sql<{ status: string }>`SELECT status FROM marketing_delivery WHERE address IS NULL AND error IS NOT NULL`.execute(tx))
    expect(reaped.rows.map(r => r.status)).toEqual(['failed'])
  })
})
