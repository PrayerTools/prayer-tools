import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'kysely'
import { withOrg } from '@prayertools/shared/db/scope'
import { addDays, todayIn, toIsoDate } from '@prayertools/shared/dates'
import { enqueue } from '@prayertools/shared/jobs'
import { parseLink } from '@prayertools/shared/links'
import { insertCommitment, leaveCampaign, setSubscriptionStatus } from '@prayertools/shared/subscriptions'
import { ptMarketingHost, CAMPAIGN_AUDIENCE_PREFIX } from '@prayertools/shared/marketing-host'
import { closeEndedCampaigns, completePersonalStart } from '../src/daily/campaigns'
import { drainJobs } from '../src/jobs/processor'
import { runReminderSweep } from '../src/reminders'
import { addCommitment, cleanup, closeEnv, createCampaign, createSite, createSubscriber, mailsTo, testCtx, testEnv, type TestEnv } from './helpers'

let env: TestEnv
beforeAll(() => { env = testEnv() })
afterEach(async () => { await cleanup(env) })
afterAll(async () => { await closeEnv(env) })

const TZ = 'America/New_York'

async function commitmentRow(orgId: string, id: string) {
  return await withOrg(env.admin, orgId, tx => tx.selectFrom('pt_commitment').selectAll().where('id', '=', id).executeTakeFirstOrThrow())
}

describe('leaving one campaign', () => {
  it('ends that campaign\'s commitments today, stops their reminders and leaves the other campaign alone', async () => {
    const { orgId } = await createSite(env)
    const today = todayIn(TZ)
    const main = await createCampaign(env, orgId, { startDate: addDays(today, -5), endDate: addDays(today, 20) })
    const side = await createCampaign(env, orgId, { kind: 'side', startDate: addDays(today, -5), endDate: addDays(today, 20) })
    const { subscriptionId, email } = await createSubscriber(env, orgId, main)
    const soon = new Date(Date.now() + 3600_000)
    const left = await addCommitment(env, orgId, subscriptionId, main, { startsOn: addDays(today, -5), endsOn: addDays(today, 20), next: soon })
    const kept = await addCommitment(env, orgId, subscriptionId, side, { startsOn: addDays(today, -5), endsOn: addDays(today, 20), next: soon })

    const ended = await withOrg(env.app, orgId, tx => leaveCampaign(tx, subscriptionId, main))
    expect(ended).toBe(1)
    const l = await commitmentRow(orgId, left)
    expect(toIsoDate(l.ends_on)).toBe(today)
    expect(l.left_at).not.toBeNull()
    expect(l.next_reminder_utc).toBeNull()
    const k = await commitmentRow(orgId, kept)
    expect(toIsoDate(k.ends_on)).toBe(addDays(today, 20))
    expect(k.left_at).toBeNull()
    expect(k.next_reminder_utc?.toISOString()).toBe(soon.toISOString())

    const ctx = testCtx(env)
    ctx.setNow(new Date(soon.getTime() + 30_000))
    await runReminderSweep(ctx, ctx.log)
    const mails = mailsTo(ctx.mails, email)
    expect(mails).toHaveLength(1)
    expect(parseLink(mails[0]!.unsubscribeUrl!.split('/l/')[1], 'l')).toMatchObject({ subscriptionId, orgId, campaignId: side })

    // A status change recomputes reminders without bringing the left one back.
    await withOrg(env.app, orgId, tx => setSubscriptionStatus(tx, subscriptionId, 'active'))
    expect((await commitmentRow(orgId, left)).next_reminder_utc).toBeNull()
    expect((await commitmentRow(orgId, kept)).next_reminder_utc).not.toBeNull()
    const sub = await withOrg(env.admin, orgId, tx => tx.selectFrom('pt_subscription').select('status').where('id', '=', subscriptionId).executeTakeFirstOrThrow())
    expect(sub.status).toBe('active')
  })

  it('drops the date picks still ahead and keeps the past ones', async () => {
    const { orgId } = await createSite(env)
    const today = todayIn(TZ)
    const campaignId = await createCampaign(env, orgId, { goal: 'coverage', startDate: addDays(today, -5), endDate: addDays(today, 20) })
    const { subscriptionId } = await createSubscriber(env, orgId, campaignId)
    const past = new Date(Date.now() - 2 * 86_400_000)
    const future = new Date(Date.now() + 2 * 86_400_000)
    const row = await withOrg(env.admin, orgId, tx => tx.insertInto('pt_commitment').values({
      subscription_id: subscriptionId,
      campaign_id: campaignId,
      kind: 'dates',
      frequency: null,
      time: '07:00',
      timezone: TZ,
      duration_min: 15,
      dates: sql`${`{"${past.toISOString()}","${future.toISOString()}"}`}::timestamptz[]`,
      starts_on: addDays(today, -5),
      ends_on: addDays(today, 20),
      next_reminder_utc: future
    }).returning('id').executeTakeFirstOrThrow())

    await withOrg(env.app, orgId, tx => leaveCampaign(tx, subscriptionId, campaignId))
    const c = await commitmentRow(orgId, row.id)
    expect(c.dates.map(d => new Date(d).toISOString())).toEqual([past.toISOString()])
    expect(c.next_reminder_utc).toBeNull()
  })

  it('sends no end-of-campaign thank-you to people who left it', async () => {
    const { orgId } = await createSite(env)
    const today = todayIn(TZ)
    const campaignId = await createCampaign(env, orgId, { startDate: addDays(today, -20), endDate: addDays(today, -1) })
    const stayed = await createSubscriber(env, orgId, campaignId)
    const leaver = await createSubscriber(env, orgId, campaignId)
    for (const s of [stayed, leaver]) {
      await addCommitment(env, orgId, s.subscriptionId, campaignId, { startsOn: addDays(today, -20), endsOn: addDays(today, -1) })
    }
    await withOrg(env.app, orgId, tx => leaveCampaign(tx, leaver.subscriptionId, campaignId))

    const ctx = testCtx(env)
    await closeEndedCampaigns(ctx, ctx.log)
    await drainJobs(ctx, ctx.log)
    expect(mailsTo(ctx.mails, stayed.email)).toHaveLength(1)
    expect(mailsTo(ctx.mails, leaver.email)).toHaveLength(0)
  })

  it('a person who left a personal-start campaign is neither thanked nor completed', async () => {
    const { orgId } = await createSite(env)
    const today = todayIn(TZ)
    const campaignId = await createCampaign(env, orgId, { startMode: 'join', endMode: 'days', lengthDays: 3 })
    const person = await createSubscriber(env, orgId, campaignId)
    await addCommitment(env, orgId, person.subscriptionId, campaignId, { startsOn: addDays(today, -5), entriesDone: 3 })
    await withOrg(env.app, orgId, tx => leaveCampaign(tx, person.subscriptionId, campaignId))

    const ctx = testCtx(env)
    expect((await completePersonalStart(ctx, ctx.log)).queued).toBe(0)
    const sub = await withOrg(env.admin, orgId, tx => tx.selectFrom('pt_subscription').select('status').where('id', '=', person.subscriptionId).executeTakeFirstOrThrow())
    expect(sub.status).toBe('active')

    // A thank-you queued before they left is skipped.
    await withOrg(env.app, orgId, tx => enqueue(tx, 'thank_you_person', { subscriptionId: person.subscriptionId, campaignId }, { orgId }))
    await drainJobs(ctx, ctx.log)
    expect(mailsTo(ctx.mails, person.email)).toHaveLength(0)
  })

  it('joining again starts a fresh commitment and keeps the left one as it was', async () => {
    const { orgId } = await createSite(env)
    const today = todayIn(TZ)
    const campaignId = await createCampaign(env, orgId, { startMode: 'join', endMode: 'none' })
    const person = await createSubscriber(env, orgId, campaignId)
    const old = await addCommitment(env, orgId, person.subscriptionId, campaignId, { startsOn: addDays(today, -5), entriesDone: 2 })
    await withOrg(env.app, orgId, tx => leaveCampaign(tx, person.subscriptionId, campaignId))
    const before = await commitmentRow(orgId, old)

    const fresh = await withOrg(env.app, orgId, async (tx) => {
      const sub = await tx.selectFrom('pt_subscription').selectAll().where('id', '=', person.subscriptionId).executeTakeFirstOrThrow()
      const campaign = await tx.selectFrom('pt_campaign').selectAll().where('id', '=', campaignId).executeTakeFirstOrThrow()
      return await insertCommitment(tx, sub, campaign, { time: '08:00', timezone: TZ })
    })
    expect(fresh.id).not.toBe(old)
    expect(fresh.left_at).toBeNull()
    expect(fresh.entries_done).toBe(0)
    expect(toIsoDate(fresh.starts_on)).toBe(today)
    expect(fresh.next_reminder_utc).not.toBeNull()
    expect(await commitmentRow(orgId, old)).toEqual(before)
  })

  it('drops out of that campaign\'s email audience', async () => {
    const { orgId } = await createSite(env)
    const today = todayIn(TZ)
    const campaignId = await createCampaign(env, orgId, { startDate: addDays(today, -5), endDate: addDays(today, 20) })
    const stayed = await createSubscriber(env, orgId, campaignId)
    const leaver = await createSubscriber(env, orgId, campaignId)
    for (const s of [stayed, leaver]) {
      await addCommitment(env, orgId, s.subscriptionId, campaignId, { startsOn: addDays(today, -5), endsOn: addDays(today, 20) })
    }
    await withOrg(env.app, orgId, tx => leaveCampaign(tx, leaver.subscriptionId, campaignId))
    const members = await withOrg(env.app, orgId, tx => ptMarketingHost.resolveAudience(tx, orgId, `${CAMPAIGN_AUDIENCE_PREFIX}${campaignId}`))
    expect(members.map(m => m.address)).toEqual([stayed.email])
  })
})
