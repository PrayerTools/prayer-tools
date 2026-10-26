import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { withOrg } from '@prayertools/shared/db/scope'
import { suppress } from '@prayertools/shared/email/suppression'
import { emailHash } from '@prayertools/shared/tokens'
import { parseLink } from '@prayertools/shared/links'
import { runReminderSweep } from '../src/reminders'
import { addCommitment, cleanup, closeEnv, createCampaign, createSite, createSubscriber, mailsTo, testCtx, testEnv, type TestEnv } from './helpers'

let env: TestEnv
beforeAll(() => { env = testEnv() })
afterEach(async () => { await cleanup(env) })
afterAll(async () => { await closeEnv(env) })

async function commitmentRow(orgId: string, id: string) {
  return await withOrg(env.admin, orgId, tx => tx.selectFrom('pt_commitment').selectAll().where('id', '=', id).executeTakeFirstOrThrow())
}

async function emailLog(orgId: string, subscriptionId: string) {
  return await withOrg(env.admin, orgId, tx => tx.selectFrom('pt_email_log').select(['kind', 'day', 'campaign_id', 'sent_at']).where('subscription_id', '=', subscriptionId).orderBy('sent_at').execute())
}

async function sentDates(orgId: string, commitmentId: string): Promise<string[]> {
  const rows = await withOrg(env.admin, orgId, tx => tx.selectFrom('pt_reminder_sent').select('local_date').where('commitment_id', '=', commitmentId).orderBy('local_date').execute())
  return rows.map(r => r.local_date)
}

describe('reminder sweep', () => {
  it('sends a New York 07:00 daily reminder across the March DST change and advances it', async () => {
    const { orgId } = await createSite(env)
    const campaignId = await createCampaign(env, orgId, { startDate: '2026-03-01', endDate: '2026-03-20' })
    const { subscriptionId, email } = await createSubscriber(env, orgId, campaignId)
    const id = await addCommitment(env, orgId, subscriptionId, campaignId, { startsOn: '2026-03-01', endsOn: '2026-03-20', next: new Date('2026-03-07T12:00:00Z'), durationMin: 15 })
    const ctx = testCtx(env)

    ctx.setNow(new Date('2026-03-07T12:00:30Z'))
    const first = await runReminderSweep(ctx, ctx.log)
    expect(first.outcomes.sent).toBe(1)
    const m1 = mailsTo(ctx.mails, email)
    expect(m1).toHaveLength(1)
    expect(m1[0]!.stream).toBe('transactional')
    expect(m1[0]!.replyTo).toBe('champion@test.example')
    expect(m1[0]!.meta).toEqual({ org_id: orgId, kind: 'reminder' })
    expect(m1[0]!.text).toContain('/pray/7')
    expect(m1[0]!.text).toContain('Day 7')
    expect(m1[0]!.text).toContain('15 minutes')
    const unsub = m1[0]!.unsubscribeUrl!.split('/u/')[1]
    expect(parseLink(unsub, 'u')).toMatchObject({ subscriptionId, orgId })
    // EST 07:00 (UTC-5) → EDT 07:00 (UTC-4) the next morning.
    let c = await commitmentRow(orgId, id)
    expect(c.next_reminder_utc?.toISOString()).toBe('2026-03-08T11:00:00.000Z')
    expect(c.claimed_at).toBeNull()

    ctx.setNow(new Date('2026-03-08T11:00:30Z'))
    await runReminderSweep(ctx, ctx.log)
    expect(mailsTo(ctx.mails, email)).toHaveLength(2)
    expect(mailsTo(ctx.mails, email)[1]!.text).toContain('/pray/8')
    c = await commitmentRow(orgId, id)
    expect(c.next_reminder_utc?.toISOString()).toBe('2026-03-09T11:00:00.000Z')
    expect(await sentDates(orgId, id)).toEqual(['2026-03-07', '2026-03-08'])
    const log = await emailLog(orgId, subscriptionId)
    expect(log.map(l => [l.kind, l.day, l.campaign_id])).toEqual([['reminder', 7, campaignId], ['reminder', 8, campaignId]])
    expect(log[0]!.sent_at.toISOString()).toBe('2026-03-07T12:00:30.000Z')
  })

  it('never sends the same day twice (dedupe on pt_reminder_sent)', async () => {
    const { orgId } = await createSite(env)
    const campaignId = await createCampaign(env, orgId, { startDate: '2026-03-01', endDate: '2026-03-20' })
    const { subscriptionId, email } = await createSubscriber(env, orgId, campaignId)
    const id = await addCommitment(env, orgId, subscriptionId, campaignId, { startsOn: '2026-03-01', endsOn: '2026-03-20', next: new Date('2026-03-10T11:00:00Z') })
    const ctx = testCtx(env)
    ctx.setNow(new Date('2026-03-10T11:01:00Z'))
    await runReminderSweep(ctx, ctx.log)
    // A crash between send and advance leaves the same occurrence due again.
    await withOrg(env.admin, orgId, tx => tx.updateTable('pt_commitment').set({ next_reminder_utc: new Date('2026-03-10T11:00:00Z'), claimed_at: null }).where('id', '=', id).execute())
    ctx.setNow(new Date('2026-03-10T11:02:00Z'))
    const again = await runReminderSweep(ctx, ctx.log)
    expect(again.outcomes.duplicate).toBe(1)
    expect(mailsTo(ctx.mails, email)).toHaveLength(1)
    expect((await commitmentRow(orgId, id)).next_reminder_utc?.toISOString()).toBe('2026-03-11T11:00:00.000Z')
  })

  it('two concurrent sweeps never double-send', async () => {
    const { orgId } = await createSite(env)
    const campaignId = await createCampaign(env, orgId, { startDate: '2026-03-01', endDate: '2026-03-20' })
    const emails: string[] = []
    for (let i = 0; i < 25; i++) {
      const { subscriptionId, email } = await createSubscriber(env, orgId, campaignId)
      emails.push(email)
      await addCommitment(env, orgId, subscriptionId, campaignId, { startsOn: '2026-03-01', endsOn: '2026-03-20', next: new Date('2026-03-12T11:00:00Z') })
    }
    const slowSend = (mails: unknown[]) => async (m: unknown) => {
      await new Promise(r => setTimeout(r, 5))
      mails.push(m)
      return { id: null }
    }
    const a: { to: string }[] = []
    const b: { to: string }[] = []
    const ctxA = testCtx(env, { sendMail: slowSend(a) as never })
    const ctxB = testCtx(env, { sendMail: slowSend(b) as never })
    ctxA.setNow(new Date('2026-03-12T11:00:10Z'))
    ctxB.setNow(new Date('2026-03-12T11:00:10Z'))
    await Promise.all([runReminderSweep(ctxA, ctxA.log, { batchSize: 5, concurrency: 3 }), runReminderSweep(ctxB, ctxB.log, { batchSize: 5, concurrency: 3 })])
    const all = [...a, ...b].map(m => m.to)
    expect(all.sort()).toEqual([...emails].sort())
    expect(a.length).toBeGreaterThan(0)
    expect(b.length).toBeGreaterThan(0)
  })

  it('skips globally suppressed addresses but keeps the commitment moving', async () => {
    const { orgId } = await createSite(env)
    const campaignId = await createCampaign(env, orgId, { startDate: '2026-03-01', endDate: '2026-03-20' })
    const { subscriptionId, email } = await createSubscriber(env, orgId, campaignId)
    const id = await addCommitment(env, orgId, subscriptionId, campaignId, { startsOn: '2026-03-01', endsOn: '2026-03-20', next: new Date('2026-03-05T12:00:00Z') })
    await suppress(env.admin, email, 'hard_bounce', null, 'test')
    try {
      const ctx = testCtx(env)
      ctx.setNow(new Date('2026-03-05T12:00:30Z'))
      const res = await runReminderSweep(ctx, ctx.log)
      expect(res.outcomes.suppressed).toBe(1)
      expect(mailsTo(ctx.mails, email)).toHaveLength(0)
      expect((await commitmentRow(orgId, id)).next_reminder_utc?.toISOString()).toBe('2026-03-06T12:00:00.000Z')
    } finally {
      await env.admin.deleteFrom('pt_suppression').where('address_hash', '=', emailHash(email)).execute()
    }
  })

  it('never reminds an unverified signup and stops its due commitment', async () => {
    const { orgId } = await createSite(env)
    const campaignId = await createCampaign(env, orgId, { startDate: '2026-03-01', endDate: '2026-03-20' })
    const { subscriptionId, email } = await createSubscriber(env, orgId, campaignId, { verified: false })
    const id = await addCommitment(env, orgId, subscriptionId, campaignId, { startsOn: '2026-03-01', endsOn: '2026-03-20', next: new Date('2026-03-05T12:00:00Z') })
    const ctx = testCtx(env)
    ctx.setNow(new Date('2026-03-05T12:00:30Z'))
    const res = await runReminderSweep(ctx, ctx.log)
    expect(res.cleared).toBeGreaterThanOrEqual(1)
    expect(mailsTo(ctx.mails, email)).toHaveLength(0)
    expect((await commitmentRow(orgId, id)).next_reminder_utc).toBeNull()
  })

  it('stops reminders at the last day and for ended campaigns', async () => {
    const { orgId } = await createSite(env)
    const campaignId = await createCampaign(env, orgId, { startDate: '2026-03-01', endDate: '2026-03-20' })
    const { subscriptionId, email } = await createSubscriber(env, orgId, campaignId)
    const last = await addCommitment(env, orgId, subscriptionId, campaignId, { startsOn: '2026-03-01', endsOn: '2026-03-20', next: new Date('2026-03-20T11:00:00Z') })
    const ended = await createCampaign(env, orgId, { startDate: '2026-03-01', endDate: '2026-03-20' })
    await withOrg(env.admin, orgId, tx => tx.updateTable('pt_campaign').set({ ended_at: new Date('2026-03-15T00:00:00Z') }).where('id', '=', ended).execute())
    const other = await createSubscriber(env, orgId, ended)
    const endedC = await addCommitment(env, orgId, other.subscriptionId, ended, { startsOn: '2026-03-01', endsOn: '2026-03-20', next: new Date('2026-03-20T11:00:00Z') })
    const ctx = testCtx(env)
    ctx.setNow(new Date('2026-03-20T11:00:30Z'))
    await runReminderSweep(ctx, ctx.log)
    expect(mailsTo(ctx.mails, email)).toHaveLength(1)
    expect(mailsTo(ctx.mails, other.email)).toHaveLength(0)
    expect((await commitmentRow(orgId, last)).next_reminder_utc).toBeNull()
    expect((await commitmentRow(orgId, endedC)).next_reminder_utc).toBeNull()
  })

  it('sends a personal-start person the entry they are on, and nothing once they have finished', async () => {
    const { orgId } = await createSite(env)
    const campaignId = await createCampaign(env, orgId, { startMode: 'join', endMode: 'days', lengthDays: 3 })
    const behind = await createSubscriber(env, orgId, campaignId)
    const onEntry = await addCommitment(env, orgId, behind.subscriptionId, campaignId, { startsOn: '2026-03-10', entriesDone: 1, advancedOn: '2026-03-12', next: new Date('2026-03-20T11:00:00Z') })
    const done = await createSubscriber(env, orgId, campaignId)
    const finished = await addCommitment(env, orgId, done.subscriptionId, campaignId, { startsOn: '2026-03-17', entriesDone: 3, advancedOn: '2026-03-19', next: new Date('2026-03-20T11:00:00Z') })
    const ctx = testCtx(env)
    ctx.setNow(new Date('2026-03-20T11:00:30Z'))
    const res = await runReminderSweep(ctx, ctx.log)
    expect(res.outcomes.finished).toBe(1)
    expect(mailsTo(ctx.mails, behind.email)).toHaveLength(1)
    expect(mailsTo(ctx.mails, behind.email)[0]!.text).toContain('/pray/2')
    expect(mailsTo(ctx.mails, done.email)).toHaveLength(0)
    expect((await commitmentRow(orgId, onEntry)).next_reminder_utc).not.toBeNull()
    expect((await commitmentRow(orgId, finished)).next_reminder_utc).toBeNull()
  })

  it('skips the personal-start reminder on a day the person already moved forward', async () => {
    const { orgId } = await createSite(env)
    const campaignId = await createCampaign(env, orgId, { startMode: 'join', endMode: 'days', lengthDays: 30 })
    const { subscriptionId, email } = await createSubscriber(env, orgId, campaignId)
    const cid = await addCommitment(env, orgId, subscriptionId, campaignId, { startsOn: '2026-03-15', entriesDone: 4, advancedOn: '2026-03-20', next: new Date('2026-03-20T11:00:00Z') })
    const ctx = testCtx(env)
    ctx.setNow(new Date('2026-03-20T11:00:30Z'))
    const res = await runReminderSweep(ctx, ctx.log)
    expect(res.outcomes.prayed).toBe(1)
    expect(mailsTo(ctx.mails, email)).toHaveLength(0)
    expect((await commitmentRow(orgId, cid)).next_reminder_utc?.toISOString()).toBe('2026-03-21T11:00:00.000Z')
  })

  it('drops personal-start reminders to weekly after three unopened ones', async () => {
    const { orgId } = await createSite(env)
    const campaignId = await createCampaign(env, orgId, { startMode: 'join', endMode: 'days', lengthDays: 30 })
    const recent = await createSubscriber(env, orgId, campaignId)
    const slowed = await addCommitment(env, orgId, recent.subscriptionId, campaignId, { startsOn: '2026-03-10', entriesDone: 2, advancedOn: '2026-03-16', next: new Date('2026-03-20T11:00:00Z') })
    const weekAgo = await createSubscriber(env, orgId, campaignId)
    const due = await addCommitment(env, orgId, weekAgo.subscriptionId, campaignId, { startsOn: '2026-03-01', entriesDone: 2, advancedOn: '2026-03-09', next: new Date('2026-03-20T11:00:00Z') })
    await withOrg(env.admin, orgId, tx => tx.insertInto('pt_reminder_sent').values([
      ...['2026-03-17', '2026-03-18', '2026-03-19'].map(d => ({ commitment_id: slowed, local_date: d, sent_at: new Date(`${d}T11:00:00Z`) })),
      ...['2026-03-11', '2026-03-12', '2026-03-13'].map(d => ({ commitment_id: due, local_date: d, sent_at: new Date(`${d}T11:00:00Z`) }))
    ]).execute())
    const ctx = testCtx(env)
    ctx.setNow(new Date('2026-03-20T11:00:30Z'))
    const res = await runReminderSweep(ctx, ctx.log)
    expect(res.outcomes.slowed).toBe(1)
    expect(mailsTo(ctx.mails, recent.email)).toHaveLength(0)
    expect(mailsTo(ctx.mails, weekAgo.email)).toHaveLength(1)
    expect(mailsTo(ctx.mails, weekAgo.email)[0]!.text).toContain('/pray/3')
  })

  it('skips an occurrence more than 6 hours late and moves to the next one', async () => {
    const { orgId } = await createSite(env)
    const campaignId = await createCampaign(env, orgId, { startDate: '2026-03-01', endDate: '2026-03-20' })
    const { subscriptionId, email } = await createSubscriber(env, orgId, campaignId)
    const id = await addCommitment(env, orgId, subscriptionId, campaignId, { startsOn: '2026-03-01', endsOn: '2026-03-20', next: new Date('2026-03-02T12:00:00Z') })
    const ctx = testCtx(env)
    ctx.setNow(new Date('2026-03-04T13:00:00Z'))
    const res = await runReminderSweep(ctx, ctx.log)
    // The 2 March occurrence is skipped; the 4 March one (1 hour late) is sent.
    expect(res.outcomes.stale).toBe(1)
    expect(mailsTo(ctx.mails, email)).toHaveLength(1)
    expect(mailsTo(ctx.mails, email)[0]!.text).toContain('/pray/4')
    expect((await commitmentRow(orgId, id)).next_reminder_utc?.toISOString()).toBe('2026-03-05T12:00:00.000Z')
  })

  it('releases the day when a send fails so it is retried after the lease', async () => {
    const { orgId } = await createSite(env)
    const campaignId = await createCampaign(env, orgId, { startDate: '2026-03-01', endDate: '2026-03-20' })
    const { subscriptionId } = await createSubscriber(env, orgId, campaignId)
    const id = await addCommitment(env, orgId, subscriptionId, campaignId, { startsOn: '2026-03-01', endsOn: '2026-03-20', next: new Date('2026-03-06T12:00:00Z') })
    const ctx = testCtx(env, { sendMail: async () => { throw new Error('smtp down') } })
    ctx.setNow(new Date('2026-03-06T12:00:30Z'))
    const res = await runReminderSweep(ctx, ctx.log)
    expect(res.outcomes.failed).toBe(1)
    const c = await commitmentRow(orgId, id)
    expect(c.next_reminder_utc?.toISOString()).toBe('2026-03-06T12:00:00.000Z')
    expect(c.claimed_at).not.toBeNull()
    expect(await sentDates(orgId, id)).toEqual([])
    expect(await emailLog(orgId, subscriptionId)).toEqual([])
    expect(res.lagMs).toBeGreaterThan(0)
  })

  it('logs an alert when the oldest due reminder is more than 10 minutes late', async () => {
    const { orgId } = await createSite(env)
    const campaignId = await createCampaign(env, orgId, { startDate: '2026-03-01', endDate: '2026-03-20' })
    const { subscriptionId } = await createSubscriber(env, orgId, campaignId)
    await addCommitment(env, orgId, subscriptionId, campaignId, { startsOn: '2026-03-01', endsOn: '2026-03-20', next: new Date('2026-03-06T12:00:00Z') })
    const ctx = testCtx(env, { sendMail: async () => { throw new Error('smtp down') } })
    ctx.setNow(new Date('2026-03-06T12:30:00Z'))
    await runReminderSweep(ctx, ctx.log)
    expect(ctx.logs.some(l => l.level === 'alert' && l.msg === 'reminders.late')).toBe(true)
  })
})
