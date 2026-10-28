import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { withOrg } from '@prayertools/shared/db/scope'
import { addDays, todayIn } from '@prayertools/shared/dates'
import { hashToken } from '@prayertools/shared/tokens'
import { createAnonymousAccount } from '@prayertools/shared/accounts'
import { runCheckins } from '../src/daily/checkins'
import { appInactivity, deleteUnverified } from '../src/daily/subscriptions'
import { drainJobs } from '../src/jobs/processor'
import { addCommitment, cleanup, closeEnv, createCampaign, createSite, createSubscriber, mailsTo, testCtx, testEnv, type TestEnv } from './helpers'
import { DAY } from '../src/util'

let env: TestEnv
beforeAll(() => { env = testEnv() })
afterEach(async () => { await cleanup(env) })
afterAll(async () => { await closeEnv(env) })

const TZ = 'America/New_York'

async function sub(orgId: string, id: string) {
  return await withOrg(env.admin, orgId, tx => tx.selectFrom('pt_subscription').selectAll().where('id', '=', id).executeTakeFirst())
}

async function checkins(orgId: string, id: string) {
  return await withOrg(env.admin, orgId, tx => tx.selectFrom('pt_checkin').selectAll().where('subscription_id', '=', id).orderBy('sent_at').execute())
}

// An ongoing campaign (no end) that started in the past, with one person
// whose last activity is `quietDays` ago.
async function ongoingSetup(quietDays: number, siteSettings: Record<string, unknown> = {}, campaign: { startDate?: string, endDate?: string, endMode?: 'none' | 'date' } = {}) {
  const { orgId } = await createSite(env, { settings: siteSettings })
  const today = todayIn(TZ)
  const start = campaign.startDate ?? addDays(today, -200)
  const campaignId = await createCampaign(env, orgId, { startDate: start, endMode: campaign.endMode ?? 'none', endDate: campaign.endDate })
  const quietSince = new Date(Date.now() - quietDays * DAY)
  const s = await createSubscriber(env, orgId, campaignId, { createdAt: quietSince, lastActivityAt: quietSince, cycleStartedAt: quietSince })
  await addCommitment(env, orgId, s.subscriptionId, campaignId, { startsOn: start, next: new Date(Date.now() + 3600_000) })
  return { orgId, campaignId, ...s }
}

describe('email check-ins', () => {
  it('check-in after 30 quiet days, one reminder a week later, inactive a week after that', async () => {
    const p = await ongoingSetup(31)
    const ctx = testCtx(env)
    const t0 = Date.now()

    expect((await runCheckins(ctx, ctx.log)).checkin).toBeGreaterThanOrEqual(1)
    expect((await runCheckins(ctx, ctx.log)).checkin).toBe(0)
    await drainJobs(ctx, ctx.log)
    let rows = await checkins(p.orgId, p.subscriptionId)
    expect(rows.map(r => r.kind)).toEqual(['checkin'])
    const mail = mailsTo(ctx.mails, p.email)[0]!
    expect(mail.subject).toBe(`Are you still praying with Test ${(await env.admin.selectFrom('orgs').select('slug').where('id', '=', p.orgId).executeTakeFirstOrThrow()).slug}?`)
    const token = mail.text.match(/\/checkin\/([^/\s]+)\/yes/)![1]!
    expect(rows[0]!.token_hash).toBe(hashToken(token))
    expect(mail.text).toContain(`/checkin/${token}/sometimes`)
    expect(mail.text).toContain(`/checkin/${token}/no`)

    ctx.setNow(new Date(t0 + 3 * DAY))
    expect((await runCheckins(ctx, ctx.log)).reminder).toBe(0)
    ctx.setNow(new Date(t0 + 8 * DAY))
    expect((await runCheckins(ctx, ctx.log)).reminder).toBeGreaterThanOrEqual(1)
    await drainJobs(ctx, ctx.log)
    rows = await checkins(p.orgId, p.subscriptionId)
    expect(rows.map(r => r.kind)).toEqual(['checkin', 'reminder'])
    expect(mailsTo(ctx.mails, p.email)[1]!.subject).toContain('Reminder: are you still praying')

    ctx.setNow(new Date(t0 + 12 * DAY))
    await runCheckins(ctx, ctx.log)
    expect((await sub(p.orgId, p.subscriptionId))!.status).toBe('active')
    ctx.setNow(new Date(t0 + 16 * DAY))
    expect((await runCheckins(ctx, ctx.log)).inactive).toBeGreaterThanOrEqual(1)
    const s = (await sub(p.orgId, p.subscriptionId))!
    expect(s.status).toBe('inactive')
    const c = await withOrg(env.admin, p.orgId, tx => tx.selectFrom('pt_commitment').select('next_reminder_utc').where('subscription_id', '=', p.subscriptionId).executeTakeFirstOrThrow())
    expect(c.next_reminder_utc).toBeNull()
  })

  it('activity after a check-in completes the cycle without a reply; the next is due 90 days later', async () => {
    const p = await ongoingSetup(31)
    const ctx = testCtx(env)
    const t0 = Date.now()
    await runCheckins(ctx, ctx.log)
    await drainJobs(ctx, ctx.log)
    await withOrg(env.admin, p.orgId, tx => tx.updateTable('pt_subscription').set({ last_activity_at: new Date(t0 + 2 * DAY) }).where('id', '=', p.subscriptionId).execute())
    ctx.setNow(new Date(t0 + 3 * DAY))
    expect((await runCheckins(ctx, ctx.log)).complete_cycle).toBeGreaterThanOrEqual(1)
    expect((await sub(p.orgId, p.subscriptionId))!.checkin_cycle_started_at!.getTime()).toBe(t0 + 3 * DAY)
    ctx.setNow(new Date(t0 + 40 * DAY))
    const r40 = await runCheckins(ctx, ctx.log)
    expect(r40.checkin + r40.reminder + r40.complete_cycle + r40.inactive).toBe(0)
    ctx.setNow(new Date(t0 + 94 * DAY))
    expect((await runCheckins(ctx, ctx.log)).checkin).toBeGreaterThanOrEqual(1)
  })

  it('an answer moves the cycle: nothing more until 90 days after it', async () => {
    const p = await ongoingSetup(31)
    const ctx = testCtx(env)
    const t0 = Date.now()
    await runCheckins(ctx, ctx.log)
    await drainJobs(ctx, ctx.log)
    await withOrg(env.admin, p.orgId, tx => tx.updateTable('pt_checkin').set({ response: 'yes', responded_at: new Date(t0 + DAY) }).where('subscription_id', '=', p.subscriptionId).execute())
    ctx.setNow(new Date(t0 + 20 * DAY))
    const r = await runCheckins(ctx, ctx.log)
    expect(await checkins(p.orgId, p.subscriptionId)).toHaveLength(1)
    expect(r.reminder).toBe(0)
    ctx.setNow(new Date(t0 + 92 * DAY))
    expect((await runCheckins(ctx, ctx.log)).checkin).toBeGreaterThanOrEqual(1)
  })

  it('skips sites with check-ins off, fixed campaigns and people who prayed recently', async () => {
    const off = await ongoingSetup(40, { checkins_enabled: false })
    const today = todayIn(TZ)
    const fixed = await ongoingSetup(40, {}, { startDate: addDays(today, -30), endMode: 'date', endDate: addDays(today, 10) })
    const long = await ongoingSetup(40, {}, { startDate: addDays(today, -30), endMode: 'date', endDate: addDays(today, 60) })
    const recent = await ongoingSetup(10)
    const ctx = testCtx(env)
    await runCheckins(ctx, ctx.log)
    const jobs = await env.admin.selectFrom('pt_job').select('org_id').where('type', '=', 'checkin_email').where('org_id', 'in', [off.orgId, fixed.orgId, recent.orgId]).execute()
    expect(jobs).toHaveLength(0)
    const longJobs = await env.admin.selectFrom('pt_job').select('org_id').where('type', '=', 'checkin_email').where('org_id', '=', long.orgId).execute()
    expect(longJobs).toHaveLength(1)
  })
})

describe('subscription housekeeping', () => {
  it('deletes web signups still unverified after 7 days, with their contact', async () => {
    const { orgId } = await createSite(env)
    const campaignId = await createCampaign(env, orgId, { endMode: 'none' })
    const old = await createSubscriber(env, orgId, campaignId, { verified: false, createdAt: new Date(Date.now() - 8 * DAY) })
    const fresh = await createSubscriber(env, orgId, campaignId, { verified: false, createdAt: new Date(Date.now() - 6 * DAY) })
    const verified = await createSubscriber(env, orgId, campaignId, { createdAt: new Date(Date.now() - 30 * DAY) })
    const ctx = testCtx(env)
    expect((await deleteUnverified(ctx, ctx.log)).deleted).toBeGreaterThanOrEqual(1)
    expect(await sub(orgId, old.subscriptionId)).toBeUndefined()
    expect(await sub(orgId, fresh.subscriptionId)).toBeDefined()
    expect(await sub(orgId, verified.subscriptionId)).toBeDefined()
    const contact = await withOrg(env.admin, orgId, tx => tx.selectFrom('crm_records').select('id').where('id', '=', old.contactId).executeTakeFirst())
    expect(contact).toBeUndefined()
    const stats = await withOrg(env.admin, orgId, tx => tx.selectFrom('pt_stat_daily').select(['metric', 'value']).where('metric', '=', 'signups').execute())
    expect(stats.reduce((n, r) => n + Number(r.value), 0)).toBe(3)
  })

  it('app subscriptions with 30 days without activity become inactive; unsubscribed stays unsubscribed', async () => {
    const { orgId } = await createSite(env)
    await createCampaign(env, orgId, { endMode: 'none' })
    const make = async (days: number, status: 'active' | 'unsubscribed' = 'active') => {
      const userId = await createAnonymousAccount(env.admin)
      env.accounts.push(userId)
      return await withOrg(env.admin, orgId, async tx => (await tx.insertInto('pt_subscription').values({
        user_id: userId, delivery: 'app', status, language: 'en', timezone: TZ, referral_code: Math.random().toString(36).slice(2, 8),
        last_activity_at: new Date(Date.now() - days * DAY), created_at: new Date(Date.now() - 60 * DAY)
      }).returning('id').executeTakeFirstOrThrow()).id)
    }
    const quiet = await make(31)
    const busy = await make(10)
    const gone = await make(40, 'unsubscribed')
    const ctx = testCtx(env)
    expect((await appInactivity(ctx, ctx.log)).inactive).toBeGreaterThanOrEqual(1)
    expect((await sub(orgId, quiet))!.status).toBe('inactive')
    expect((await sub(orgId, quiet))!.inactive_at).not.toBeNull()
    expect((await sub(orgId, busy))!.status).toBe('active')
    expect((await sub(orgId, gone))!.status).toBe('unsubscribed')
  })
})

