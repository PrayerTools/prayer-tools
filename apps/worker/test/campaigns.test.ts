import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { withOrg } from '@prayertools/shared/db/scope'
import { addDays, todayIn } from '@prayertools/shared/dates'
import { jsonb } from '@prayertools/shared/db/json'
import { suppress } from '@prayertools/shared/email/suppression'
import { emailHash } from '@prayertools/shared/tokens'
import { makeText } from '@prayertools/shared/translatable'
import { closeEndedCampaigns, completePersonalStart } from '../src/daily/campaigns'
import { drainJobs } from '../src/jobs/processor'
import { THANK_YOU_BATCH } from '../src/jobs/thank-you'
import { addCommitment, cleanup, closeEnv, createCampaign, createSite, createSubscriber, makeJobsDue, mailsTo, testCtx, testEnv, type TestEnv } from './helpers'

let env: TestEnv
beforeAll(() => { env = testEnv() })
afterEach(async () => { await cleanup(env) })
afterAll(async () => { await closeEnv(env) })

const TZ = 'America/New_York'

async function jobsOf(orgId: string) {
  return await env.admin.selectFrom('pt_job').selectAll().where('org_id', '=', orgId).orderBy('id').execute()
}

describe('end of a shared-calendar campaign', () => {
  it('closes the campaign, queues one thank-you and emails every intercessor except unsubscribed, unverified and suppressed', async () => {
    const { orgId } = await createSite(env, { languages: ['en', 'fr'] })
    const today = todayIn(TZ)
    const campaignId = await createCampaign(env, orgId, {
      name: 'Lent',
      startDate: addDays(today, -20),
      endDate: addDays(today, -1),
      endMessage: { source: 'en', values: { en: 'See you next year!', fr: 'À l\'année prochaine !' } },
      cta: { label: makeText('en', 'Join the next one'), url: 'https://example.org/next' }
    })
    const a = await createSubscriber(env, orgId, campaignId)
    const fr = await createSubscriber(env, orgId, campaignId, { language: 'fr' })
    const unsub = await createSubscriber(env, orgId, campaignId, { status: 'unsubscribed' })
    const unverified = await createSubscriber(env, orgId, campaignId, { verified: false })
    const suppressed = await createSubscriber(env, orgId, campaignId)
    const inactive = await createSubscriber(env, orgId, campaignId, { status: 'inactive' })
    for (const s of [a, fr, unsub, unverified, suppressed, inactive]) {
      await addCommitment(env, orgId, s.subscriptionId, campaignId, { startsOn: addDays(today, -20), endsOn: addDays(today, -1) })
    }
    await withOrg(env.admin, orgId, tx => tx.insertInto('pt_person_total').values({ campaign_id: campaignId, subscription_id: a.subscriptionId, prayers: 3, seconds: 1800 }).execute())
    await suppress(env.admin, suppressed.email, 'complaint', null, 'test')
    try {
      const ctx = testCtx(env)
      const res = await closeEndedCampaigns(ctx, ctx.log)
      expect(res.closed).toBeGreaterThanOrEqual(1)
      const again = await closeEndedCampaigns(ctx, ctx.log)
      expect(again.closed).toBe(0)
      const jobs = await jobsOf(orgId)
      expect(jobs.map(j => j.type)).toEqual(['thank_you'])
      const campaign = await withOrg(env.admin, orgId, tx => tx.selectFrom('pt_campaign').select('ended_at').where('id', '=', campaignId).executeTakeFirstOrThrow())
      expect(campaign.ended_at).not.toBeNull()

      await drainJobs(ctx, ctx.log)
      expect(mailsTo(ctx.mails, a.email)).toHaveLength(1)
      expect(mailsTo(ctx.mails, inactive.email)).toHaveLength(1)
      expect(mailsTo(ctx.mails, unsub.email)).toHaveLength(0)
      expect(mailsTo(ctx.mails, unverified.email)).toHaveLength(0)
      expect(mailsTo(ctx.mails, suppressed.email)).toHaveLength(0)
      const mail = mailsTo(ctx.mails, a.email)[0]!
      expect(mail.subject).toContain('Thank you for praying')
      expect(mail.text).toContain('Lent has come to an end')
      expect(mail.text).toContain('You prayed 3 times, for 30 minutes in all.')
      expect(mail.text).toContain('See you next year!')
      expect(mail.text).toContain('Join the next one: https://example.org/next')
      expect(mail.meta).toEqual({ org_id: orgId, kind: 'thank_you' })
      const frMail = mailsTo(ctx.mails, fr.email)[0]!
      expect(frMail.subject).toContain('Merci')
      expect(frMail.text).toContain('À l\'année prochaine !')
      const done = await jobsOf(orgId)
      expect(done[0]!.status).toBe('completed')
      expect(done[0]!.result).toMatchObject({ sent: 3, skipped: 1 })
    } finally {
      await env.admin.deleteFrom('pt_suppression').where('address_hash', '=', emailHash(suppressed.email)).execute()
    }
  })

  it('a thank-you retried after a failed send never emails anyone twice', async () => {
    const { orgId } = await createSite(env)
    const today = todayIn(TZ)
    const campaignId = await createCampaign(env, orgId, { startDate: addDays(today, -10), endDate: addDays(today, -1) })
    const people = []
    for (let i = 0; i < THANK_YOU_BATCH + 5; i++) {
      const s = await createSubscriber(env, orgId, campaignId)
      await addCommitment(env, orgId, s.subscriptionId, campaignId, { startsOn: addDays(today, -10), endsOn: addDays(today, -1) })
      people.push(s)
    }
    let calls = 0
    const sent: string[] = []
    const ctx = testCtx(env, {
      sendMail: async (m) => {
        calls++
        if (calls === THANK_YOU_BATCH + 3) throw new Error('provider hiccup')
        sent.push(m.to)
        return { id: null }
      }
    })
    await closeEndedCampaigns(ctx, ctx.log)
    await drainJobs(ctx, ctx.log)
    expect((await jobsOf(orgId))[0]!.status).toBe('pending')
    await makeJobsDue(env)
    await drainJobs(ctx, ctx.log)
    const job = (await jobsOf(orgId))[0]!
    expect(job.status).toBe('completed')
    expect(sent.sort()).toEqual(people.map(p => p.email).sort())
  })

  it('does not close campaigns before their end date has passed in their timezone', async () => {
    const { orgId } = await createSite(env)
    const today = todayIn(TZ)
    const campaignId = await createCampaign(env, orgId, { startDate: addDays(today, -5), endDate: today })
    const ctx = testCtx(env)
    await closeEndedCampaigns(ctx, ctx.log)
    const c = await withOrg(env.admin, orgId, tx => tx.selectFrom('pt_campaign').select('ended_at').where('id', '=', campaignId).executeTakeFirstOrThrow())
    expect(c.ended_at).toBeNull()
    expect(await jobsOf(orgId)).toHaveLength(0)
  })

  it('leaves draft campaigns open', async () => {
    const { orgId } = await createSite(env)
    const today = todayIn(TZ)
    const campaignId = await createCampaign(env, orgId, { startDate: addDays(today, -10), endDate: addDays(today, -2), published: false })
    const ctx = testCtx(env)
    await closeEndedCampaigns(ctx, ctx.log)
    const c = await withOrg(env.admin, orgId, tx => tx.selectFrom('pt_campaign').select('ended_at').where('id', '=', campaignId).executeTakeFirstOrThrow())
    expect(c.ended_at).toBeNull()
    expect(await jobsOf(orgId)).toHaveLength(0)
  })
})

describe('personal-start completion', () => {
  it('marks the subscription completed after the last entry is opened, stops reminders and sends the personal thank-you', async () => {
    const { orgId } = await createSite(env)
    const today = todayIn(TZ)
    const campaignId = await createCampaign(env, orgId, { name: 'Seven days', startMode: 'join', endMode: 'days', lengthDays: 7 })
    const done = await createSubscriber(env, orgId, campaignId)
    const cid = await addCommitment(env, orgId, done.subscriptionId, campaignId, { startsOn: addDays(today, -8), entriesDone: 7, next: new Date(Date.now() + 3600_000) })
    const midway = await createSubscriber(env, orgId, campaignId)
    await addCommitment(env, orgId, midway.subscriptionId, campaignId, { startsOn: addDays(today, -30), entriesDone: 6 })
    const ctx = testCtx(env)
    const res = await completePersonalStart(ctx, ctx.log)
    expect(res.completed).toBeGreaterThanOrEqual(1)
    const subs = await withOrg(env.admin, orgId, tx => tx.selectFrom('pt_subscription').select(['id', 'status', 'completed_at']).execute())
    expect(subs.find(s => s.id === done.subscriptionId)!.status).toBe('completed')
    expect(subs.find(s => s.id === midway.subscriptionId)!.status).toBe('active')
    const c = await withOrg(env.admin, orgId, tx => tx.selectFrom('pt_commitment').select('next_reminder_utc').where('id', '=', cid).executeTakeFirstOrThrow())
    expect(c.next_reminder_utc).toBeNull()
    expect((await jobsOf(orgId)).map(j => j.type)).toEqual(['thank_you_person'])
    expect((await completePersonalStart(ctx, ctx.log)).queued).toBe(0)

    await drainJobs(ctx, ctx.log)
    const mails = mailsTo(ctx.mails, done.email)
    expect(mails).toHaveLength(1)
    expect(mails[0]!.text).toContain('You have reached the end of Seven days')
    expect(mailsTo(ctx.mails, midway.email)).toHaveLength(0)
  })

  it('without a length, runs for as many entries as the content has', async () => {
    const { orgId } = await createSite(env)
    const today = todayIn(TZ)
    const campaignId = await createCampaign(env, orgId, { startMode: 'join', endMode: 'days', lengthDays: null })
    const done = await createSubscriber(env, orgId, campaignId)
    await addCommitment(env, orgId, done.subscriptionId, campaignId, { startsOn: addDays(today, -6), entriesDone: 5 })
    const midway = await createSubscriber(env, orgId, campaignId)
    await addCommitment(env, orgId, midway.subscriptionId, campaignId, { startsOn: addDays(today, -6), entriesDone: 4 })
    const ctx = testCtx(env)
    const statusOf = async (id: string) => (await withOrg(env.admin, orgId, tx => tx.selectFrom('pt_subscription').select('status').where('id', '=', id).executeTakeFirstOrThrow())).status

    await completePersonalStart(ctx, ctx.log)
    expect(await statusOf(done.subscriptionId)).toBe('active')

    await withOrg(env.admin, orgId, async (tx) => {
      const lib = await tx.insertInto('pt_site_library').values({ title: 'Five days', cadence: 'daily' }).returning('id').executeTakeFirstOrThrow()
      await tx.insertInto('pt_campaign_library').values({ campaign_id: campaignId, site_library_id: lib.id }).execute()
      for (let day = 1; day <= 5; day++) {
        await tx.insertInto('pt_site_entry').values({ site_library_id: lib.id, day, language: 'en', content: jsonb({ type: 'doc', content: [] }) }).execute()
      }
    })
    await completePersonalStart(ctx, ctx.log)
    expect(await statusOf(done.subscriptionId)).toBe('completed')
    expect(await statusOf(midway.subscriptionId)).toBe('active')
  })

  it('thanks each finished campaign once, also when the person finishes another later', async () => {
    const { orgId } = await createSite(env)
    const today = todayIn(TZ)
    const first = await createCampaign(env, orgId, { startMode: 'join', endMode: 'days', lengthDays: 3 })
    const second = await createCampaign(env, orgId, { startMode: 'join', endMode: 'days', lengthDays: 3 })
    const person = await createSubscriber(env, orgId, first)
    await addCommitment(env, orgId, person.subscriptionId, first, { startsOn: addDays(today, -5), entriesDone: 3 })
    const ctx = testCtx(env)
    await completePersonalStart(ctx, ctx.log)

    await withOrg(env.admin, orgId, tx => tx.updateTable('pt_subscription').set({ status: 'active', completed_at: null }).where('id', '=', person.subscriptionId).execute())
    const later = await addCommitment(env, orgId, person.subscriptionId, second, { startsOn: addDays(today, -2), entriesDone: 1 })
    await completePersonalStart(ctx, ctx.log)
    await withOrg(env.admin, orgId, tx => tx.updateTable('pt_commitment').set({ entries_done: 3 }).where('id', '=', later).execute())
    await completePersonalStart(ctx, ctx.log)

    const thanks = (await jobsOf(orgId)).filter(j => j.type === 'thank_you_person').map(j => (j.payload as { campaignId: string }).campaignId)
    expect(thanks).toEqual([first, second])
  })

  it('thanks a finished personal-start campaign while a side campaign is still running', async () => {
    const { orgId } = await createSite(env)
    const today = todayIn(TZ)
    const personal = await createCampaign(env, orgId, { startMode: 'join', endMode: 'days', lengthDays: 3 })
    const side = await createCampaign(env, orgId, { kind: 'side', startDate: addDays(today, -3), endDate: addDays(today, 10) })
    const person = await createSubscriber(env, orgId, personal)
    await addCommitment(env, orgId, person.subscriptionId, personal, { startsOn: addDays(today, -5), entriesDone: 3 })
    await addCommitment(env, orgId, person.subscriptionId, side, { startsOn: addDays(today, -3), endsOn: addDays(today, 10) })
    const ctx = testCtx(env)
    await completePersonalStart(ctx, ctx.log)

    expect((await jobsOf(orgId)).map(j => j.type)).toEqual(['thank_you_person'])
    const sub = await withOrg(env.admin, orgId, tx => tx.selectFrom('pt_subscription').select('status').where('id', '=', person.subscriptionId).executeTakeFirstOrThrow())
    expect(sub.status).toBe('active')
  })
})
