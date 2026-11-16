import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { withOrg } from '@prayertools/shared/db/scope'
import { PURPOSE_SITE_UPDATES, setConsent, upsertContact } from '@prayertools/shared/crm'
import { addDays, todayIn } from '@prayertools/shared/dates'
import { suppress } from '@prayertools/shared/email/suppression'
import { ptMarketingHost, WAITING_AUDIENCE_PREFIX } from '@prayertools/shared/marketing-host'
import { campaignById } from '@prayertools/shared/campaigns'
import { confirmNotify, nextRun, notifyOffer, requestNotify, waitingCounts } from '@prayertools/shared/notify-requests'
import { announceRunsAgain } from '../src/daily/runs-again'
import { cleanup, closeEnv, createCampaign, createSite, mailsTo, testCtx, testEmail, testEnv, type TestEnv } from './helpers'

let env: TestEnv
beforeAll(() => { env = testEnv() })
afterEach(async () => { await cleanup(env) })
afterAll(async () => { await closeEnv(env) })

const today = todayIn('America/New_York')

async function endedCampaign(orgId: string, name = 'Lent 2026') {
  return await createCampaign(env, orgId, { name, startDate: addDays(today, -40), endDate: addDays(today, -10) })
}

async function askToHear(orgId: string, campaignId: string, opts: { confirm?: boolean, email?: string } = {}) {
  const email = opts.email ?? testEmail(env, 'notify')
  return await withOrg(env.admin, orgId, async (tx) => {
    const contact = await upsertContact(tx, { email, source: 'test' })
    await setConsent(tx, contact.channelId, PURPOSE_SITE_UPDATES, true, { wording: {}, surface: 'test', source: 'test' })
    const token = await requestNotify(tx, { contactId: contact.contactId, campaignId, language: 'en' })
    if (opts.confirm !== false) expect(await confirmNotify(tx, token!)).toEqual({ campaignId })
    return { email, channelId: contact.channelId, token }
  })
}

async function publish(orgId: string, campaignId: string) {
  await withOrg(env.admin, orgId, tx => tx.updateTable('pt_campaign').set({ published_at: new Date() }).where('id', '=', campaignId).execute())
}

// What the campaign's ended page offers, read as the public server reads it.
async function offerOn(orgId: string, campaignId: string) {
  return await withOrg(env.app, orgId, async (tx) => {
    const site = await tx.selectFrom('pt_site').select('status').executeTakeFirstOrThrow()
    const campaign = (await campaignById(tx, campaignId, { drafts: true }))!
    const offer = await notifyOffer(tx, site, campaign)
    return { form: offer.form, running: offer.running?.id ?? null }
  })
}

async function requestOf(orgId: string, email: string) {
  return await withOrg(env.admin, orgId, tx => tx
    .selectFrom('pt_notify_request as n')
    .innerJoin('crm_contact_channels as cc', 'cc.record_id', 'n.contact_id')
    .innerJoin('crm_channels as ch', 'ch.id', 'cc.channel_id')
    .select(['n.confirmed_at', 'n.notified_at', 'n.notified_campaign_id'])
    .where('ch.normalized_value', '=', email.toLowerCase())
    .executeTakeFirstOrThrow())
}

describe('notify me when a campaign runs again', () => {
  it('emails each confirmed request once when the next run is published, and never an unconfirmed one', async () => {
    const { orgId } = await createSite(env)
    const first = await endedCampaign(orgId)
    const confirmed = await askToHear(orgId, first)
    const unconfirmed = await askToHear(orgId, first, { confirm: false })
    const ctx = testCtx(env)

    expect(await announceRunsAgain(ctx, ctx.log)).toMatchObject({ sent: 0 })
    const next = await createCampaign(env, orgId, { name: 'Lent 2027', relaunchOf: first, startDate: addDays(today, 10), endDate: addDays(today, 40), published: false })
    expect(await announceRunsAgain(ctx, ctx.log)).toMatchObject({ sent: 0 })
    expect(ctx.mails).toHaveLength(0)

    await withOrg(env.admin, orgId, tx => tx.updateTable('pt_campaign').set({ published_at: new Date() }).where('id', '=', next).execute())
    expect(await announceRunsAgain(ctx, ctx.log)).toMatchObject({ sent: 1 })
    const mails = mailsTo(ctx.mails, confirmed.email)
    expect(mails).toHaveLength(1)
    expect(mails[0]!.subject).toBe('Lent 2027 is running again')
    expect(mails[0]!.text).toMatch(/\/signup\b/)
    expect(mailsTo(ctx.mails, unconfirmed.email)).toHaveLength(0)
    expect(await requestOf(orgId, confirmed.email)).toMatchObject({ notified_campaign_id: next })

    expect(await announceRunsAgain(ctx, ctx.log)).toMatchObject({ sent: 0 })
    expect(ctx.mails).toHaveLength(1)
    expect((await requestOf(orgId, unconfirmed.email)).notified_at).toBeNull()
  })

  it('confirms a link once, and a confirmed request asked again sends no new link', async () => {
    const { orgId } = await createSite(env)
    const first = await endedCampaign(orgId)
    const { token, email } = await askToHear(orgId, first)
    await withOrg(env.admin, orgId, async (tx) => {
      expect(await confirmNotify(tx, token!)).toBeNull()
      const contact = await upsertContact(tx, { email })
      expect(await requestNotify(tx, { contactId: contact.contactId, campaignId: first, language: 'en' })).toBeNull()
    })
  })

  it('leaves suppressed and opted-out addresses waiting, and retries a failed send without sending twice', async () => {
    const { orgId } = await createSite(env)
    const first = await endedCampaign(orgId)
    const flaky = await askToHear(orgId, first)
    const bounced = await askToHear(orgId, first)
    const optedOut = await askToHear(orgId, first)
    await suppress(env.admin, bounced.email, 'hard_bounce', null, 'test')
    await withOrg(env.admin, orgId, tx => setConsent(tx, optedOut.channelId, PURPOSE_SITE_UPDATES, false, { wording: {}, surface: 'test', source: 'test' }))
    await createCampaign(env, orgId, { name: 'Lent 2027', relaunchOf: first, startDate: addDays(today, -1), endDate: addDays(today, 30) })

    let fail = true
    const ctx = testCtx(env, {
      sendMail: async () => {
        if (fail) throw new Error('smtp down')
        return { id: null }
      }
    })
    expect(await announceRunsAgain(ctx, ctx.log)).toEqual({ sent: 0, skipped: 2, failed: 1 })
    expect((await requestOf(orgId, flaky.email)).notified_at).toBeNull()

    fail = false
    const ok = testCtx(env)
    expect(await announceRunsAgain(ok, ok.log)).toEqual({ sent: 1, skipped: 2, failed: 0 })
    expect(mailsTo(ok.mails, flaky.email)).toHaveLength(1)
    expect(ok.mails).toHaveLength(1)
    expect(await announceRunsAgain(ok, ok.log)).toEqual({ sent: 0, skipped: 2, failed: 0 })
    expect(ok.mails).toHaveLength(1)
  })

  it('offers site email an audience of the people still waiting', async () => {
    const { orgId } = await createSite(env)
    const first = await endedCampaign(orgId)
    const waiting = await askToHear(orgId, first)
    await askToHear(orgId, first, { confirm: false })
    const key = `${WAITING_AUDIENCE_PREFIX}${first}`

    await withOrg(env.app, orgId, async (tx) => {
      const audiences = await ptMarketingHost.listAudiences(tx, orgId)
      expect(audiences.find(a => a.key === key)).toMatchObject({ label: 'Waiting for Lent 2026 to run again', purpose: PURPOSE_SITE_UPDATES })
      const members = await ptMarketingHost.resolveAudience(tx, orgId, key)
      expect(members.map(m => m.address)).toEqual([waiting.email])
    })

    await createCampaign(env, orgId, { name: 'Lent 2027', relaunchOf: first, startDate: addDays(today, 10), endDate: addDays(today, 40) })
    const ctx = testCtx(env)
    await announceRunsAgain(ctx, ctx.log)
    await withOrg(env.app, orgId, async (tx) => {
      expect(await ptMarketingHost.resolveAudience(tx, orgId, key)).toEqual([])
      expect((await ptMarketingHost.listAudiences(tx, orgId)).some(a => a.key === key)).toBe(false)
    })
  })

  it('offers the form on an ended campaign only while no run of its series is open', async () => {
    const { orgId } = await createSite(env)
    const running = await createCampaign(env, orgId, { name: 'Pray for France', startDate: addDays(today, -5), endMode: 'none' })
    const first = await createCampaign(env, orgId, { name: 'Ramadan 2026', kind: 'side', startDate: addDays(today, -40), endDate: addDays(today, -10) })
    const draft = await createCampaign(env, orgId, { name: 'Old draft', kind: 'side', startDate: addDays(today, -40), endDate: addDays(today, -10), published: false })

    expect(await offerOn(orgId, first)).toEqual({ form: true, running: null })
    expect(await offerOn(orgId, running)).toEqual({ form: false, running: null })
    expect(await offerOn(orgId, draft)).toEqual({ form: false, running: null })

    const next = await createCampaign(env, orgId, { name: 'Ramadan 2027', kind: 'side', relaunchOf: first, startDate: addDays(today, 10), endDate: addDays(today, 40), published: false })
    expect(await offerOn(orgId, first)).toEqual({ form: true, running: null })
    await publish(orgId, next)
    expect(await offerOn(orgId, first)).toEqual({ form: false, running: next })
    expect(await offerOn(orgId, next)).toEqual({ form: false, running: null })

    await withOrg(env.admin, orgId, tx => tx.updateTable('pt_campaign').set({ ended_at: new Date() }).where('id', '=', next).execute())
    expect(await offerOn(orgId, first)).toEqual({ form: true, running: null })
    expect(await offerOn(orgId, next)).toEqual({ form: true, running: null })

    await withOrg(env.admin, orgId, tx => tx.updateTable('pt_site').set({ status: 'archived' }).execute())
    expect(await offerOn(orgId, first)).toEqual({ form: false, running: null })
  })

  it('answers with the run after the latest one when the later runs have ended too', async () => {
    const { orgId } = await createSite(env)
    const first = await endedCampaign(orgId, 'Ramadan 2025')
    const second = await createCampaign(env, orgId, { name: 'Ramadan 2026', relaunchOf: first, startDate: addDays(today, -30), endDate: addDays(today, -5) })
    await createCampaign(env, orgId, { name: 'Advent', startDate: addDays(today, -1), endDate: addDays(today, 20) })
    const onFirst = await askToHear(orgId, first)
    const onSecond = await askToHear(orgId, second)
    const ctx = testCtx(env)

    expect(await announceRunsAgain(ctx, ctx.log)).toEqual({ sent: 0, skipped: 0, failed: 0 })
    expect((await requestOf(orgId, onFirst.email)).notified_at).toBeNull()

    const third = await createCampaign(env, orgId, { name: 'Ramadan 2027', relaunchOf: second, startDate: addDays(today, 10), endDate: addDays(today, 40), published: false })
    expect(await announceRunsAgain(ctx, ctx.log)).toMatchObject({ sent: 0 })
    await publish(orgId, third)
    expect(await announceRunsAgain(ctx, ctx.log)).toMatchObject({ sent: 2 })
    for (const asked of [onFirst, onSecond]) {
      expect(mailsTo(ctx.mails, asked.email).map(m => m.subject)).toEqual(['Ramadan 2027 is running again'])
      expect(await requestOf(orgId, asked.email)).toMatchObject({ notified_campaign_id: third })
    }
  })

  it('answers with a run that was set up before the campaign asked on and published after it', async () => {
    const { orgId } = await createSite(env)
    const first = await endedCampaign(orgId, 'Ramadan 2025')
    const shelved = await createCampaign(env, orgId, { name: 'Ramadan 2027', relaunchOf: first, startDate: addDays(today, 10), endDate: addDays(today, 40), published: false })
    const second = await createCampaign(env, orgId, { name: 'Ramadan 2026', relaunchOf: first, startDate: addDays(today, -30), endDate: addDays(today, -5) })
    const asked = await askToHear(orgId, second)
    const ctx = testCtx(env)

    expect(await announceRunsAgain(ctx, ctx.log)).toMatchObject({ sent: 0 })
    await publish(orgId, shelved)
    expect(await withOrg(env.app, orgId, async tx => (await nextRun(tx, second))?.id)).toBe(shelved)
    expect(await announceRunsAgain(ctx, ctx.log)).toMatchObject({ sent: 1 })
    expect(await requestOf(orgId, asked.email)).toMatchObject({ notified_campaign_id: shelved })
  })

  it('emails a person once who asked on two runs of the series', async () => {
    const { orgId } = await createSite(env)
    const first = await endedCampaign(orgId, 'Ramadan 2025')
    const second = await createCampaign(env, orgId, { name: 'Ramadan 2026', relaunchOf: first, startDate: addDays(today, -30), endDate: addDays(today, -5) })
    const { email } = await askToHear(orgId, first)
    await askToHear(orgId, second, { email })
    await createCampaign(env, orgId, { name: 'Ramadan 2027', relaunchOf: second, startDate: addDays(today, 10), endDate: addDays(today, 40) })
    const ctx = testCtx(env)

    expect(await announceRunsAgain(ctx, ctx.log)).toMatchObject({ sent: 1 })
    expect(mailsTo(ctx.mails, email)).toHaveLength(1)
    expect(await withOrg(env.admin, orgId, tx => waitingCounts(tx))).toEqual(new Map())
    expect(await announceRunsAgain(ctx, ctx.log)).toMatchObject({ sent: 0 })
    expect(ctx.mails).toHaveLength(1)
  })

  it('counts the confirmed requests still waiting on each campaign', async () => {
    const { orgId } = await createSite(env)
    const first = await endedCampaign(orgId, 'Ramadan 2025')
    const other = await endedCampaign(orgId, 'Advent 2025')
    await askToHear(orgId, first)
    await askToHear(orgId, first)
    await askToHear(orgId, first, { confirm: false })
    await askToHear(orgId, other, { confirm: false })
    expect(await withOrg(env.app, orgId, tx => waitingCounts(tx))).toEqual(new Map([[first, 2]]))

    await createCampaign(env, orgId, { name: 'Ramadan 2026', relaunchOf: first, startDate: addDays(today, 10), endDate: addDays(today, 40) })
    const ctx = testCtx(env)
    await announceRunsAgain(ctx, ctx.log)
    expect(await withOrg(env.app, orgId, tx => waitingCounts(tx))).toEqual(new Map())
  })
})
