import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { withOrg } from '@prayertools/shared/db/scope'
import { PURPOSE_SITE_UPDATES, setConsent, upsertContact } from '@prayertools/shared/crm'
import { addDays, todayIn } from '@prayertools/shared/dates'
import { suppress } from '@prayertools/shared/email/suppression'
import { ptMarketingHost, WAITING_AUDIENCE_PREFIX } from '@prayertools/shared/marketing-host'
import { confirmNotify, requestNotify } from '@prayertools/shared/notify-requests'
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

async function askToHear(orgId: string, campaignId: string, opts: { confirm?: boolean } = {}) {
  const email = testEmail(env, 'notify')
  return await withOrg(env.admin, orgId, async (tx) => {
    const contact = await upsertContact(tx, { email, source: 'test' })
    await setConsent(tx, contact.channelId, PURPOSE_SITE_UPDATES, true, { wording: {}, surface: 'test', source: 'test' })
    const token = await requestNotify(tx, { contactId: contact.contactId, campaignId, language: 'en' })
    if (opts.confirm !== false) expect(await confirmNotify(tx, token!)).toEqual({ campaignId })
    return { email, channelId: contact.channelId, token }
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
})
