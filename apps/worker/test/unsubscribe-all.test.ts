import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { withOrg } from '@prayertools/shared/db/scope'
import { accountByEmail, linkContactToAccount } from '@prayertools/shared/accounts'
import { primaryEmailOf, setConsent, upsertContact, type ConsentCapture } from '@prayertools/shared/crm'
import { createWebSignup } from '@prayertools/shared/subscriptions'
import { unsubscribeEverywhere } from '@prayertools/shared/unsubscribe-all'
import { addCommitment, cleanup, closeEnv, createCampaign, createSite, testEmail, testEnv, uid, type TestEnv } from './helpers'

let env: TestEnv
beforeAll(() => { env = testEnv() })
afterEach(async () => { await cleanup(env) })
afterAll(async () => { await closeEnv(env) })

const capture: ConsentCapture = { wording: { key: 'test' }, surface: 'test', source: 'test' }
const SOON = new Date(Date.now() + 3600_000)

// A verified web signup on the RLS connection, with a reminder due and site
// updates plus a custom consent granted.
async function praying(orgId: string, campaignId: string, email: string) {
  const sub = await withOrg(env.app, orgId, async (tx) => {
    const campaign = await tx.selectFrom('pt_campaign').selectAll().where('id', '=', campaignId).executeTakeFirstOrThrow()
    const res = await createWebSignup(tx, { campaign, email, name: 'Test Person', language: 'en', timezone: 'UTC', commitments: [], consents: {}, preVerified: true, capture: { surface: 'test', source: 'test' } })
    return { subscriptionId: res.subscription.id, contactId: res.contactId }
  })
  await addCommitment(env, orgId, sub.subscriptionId, campaignId, { startsOn: '2026-01-01', next: SOON })
  await withOrg(env.app, orgId, async (tx) => {
    const ch = (await primaryEmailOf(tx, sub.contactId))!
    await setConsent(tx, ch.channelId, 'site_updates', true, capture)
    await setConsent(tx, ch.channelId, 'custom:church', true, capture)
  })
  return sub
}

async function stateOf(orgId: string, subscriptionId: string, contactId: string) {
  return await withOrg(env.app, orgId, async (tx) => {
    const ch = (await primaryEmailOf(tx, contactId))!
    return {
      status: (await tx.selectFrom('pt_subscription').select('status').where('id', '=', subscriptionId).executeTakeFirstOrThrow()).status,
      reminders: (await tx.selectFrom('pt_commitment').select('next_reminder_utc').where('subscription_id', '=', subscriptionId).execute()).map(c => c.next_reminder_utc),
      consents: Object.fromEntries((await tx.selectFrom('crm_channel_consents').select(['purpose', 'status']).where('channel_id', '=', ch.channelId).execute()).map(c => [c.purpose, c.status]))
    }
  })
}

describe('unsubscribeEverywhere', () => {
  it('stops every site of the account and News from Prayer.Tools, and leaves other people alone', async () => {
    const a = await createSite(env)
    const b = await createSite(env)
    const campA = await createCampaign(env, a.orgId, { endMode: 'none' })
    const campB = await createCampaign(env, b.orgId, { endMode: 'none' })
    const email = testEmail(env)
    const subA = await praying(a.orgId, campA, email)
    const subB = await praying(b.orgId, campB, email)
    const other = await praying(a.orgId, campA, testEmail(env))
    const account = (await accountByEmail(env.admin, email))!

    const news = await env.admin.insertInto('orgs').values({ slug: `staff-${uid()}`, name: 'Prayer.Tools', created_at: new Date(), updated_at: new Date() }).returning('id').executeTakeFirstOrThrow()
    env.orgs.push(news.id)
    const newsChannel = await withOrg(env.app, news.id, async (tx) => {
      const contact = await upsertContact(tx, { email, name: 'Test Person' })
      await setConsent(tx, contact.channelId, 'platform_news', true, capture)
      await linkContactToAccount(tx, contact.contactId, account)
      return contact.channelId
    })

    await unsubscribeEverywhere(env.app, account.id, { newsOrgId: news.id, capture: { ...capture, surface: 'my_prayer' } })

    for (const [orgId, sub] of [[a.orgId, subA], [b.orgId, subB]] as const) {
      expect(await stateOf(orgId, sub.subscriptionId, sub.contactId)).toEqual({
        status: 'unsubscribed',
        reminders: [null],
        consents: { 'site_updates': 'opt_out', 'custom:church': 'opt_out' }
      })
    }
    const revoked = await withOrg(env.app, news.id, async tx => ({
      consent: await tx.selectFrom('crm_channel_consents').select('status').where('channel_id', '=', newsChannel).where('purpose', '=', 'platform_news').executeTakeFirstOrThrow(),
      events: await tx.selectFrom('crm_consent_events').select(['event', 'source']).where('channel_id', '=', newsChannel).orderBy('occurred_at').execute()
    }))
    expect(revoked.consent.status).toBe('opt_out')
    expect(revoked.events.at(-1)).toEqual({ event: 'revoke', source: 'test' })

    expect(await stateOf(a.orgId, other.subscriptionId, other.contactId)).toEqual({
      status: 'active',
      reminders: [SOON],
      consents: { 'site_updates': 'opt_in', 'custom:church': 'opt_in' }
    })
  })

  it('remindersOnly stops the subscriptions and keeps every consent', async () => {
    const { orgId } = await createSite(env)
    const campaignId = await createCampaign(env, orgId, { endMode: 'none' })
    const email = testEmail(env)
    const sub = await praying(orgId, campaignId, email)
    const account = (await accountByEmail(env.admin, email))!
    await unsubscribeEverywhere(env.app, account.id, { capture, remindersOnly: true })
    expect(await stateOf(orgId, sub.subscriptionId, sub.contactId)).toEqual({
      status: 'unsubscribed',
      reminders: [null],
      consents: { 'site_updates': 'opt_in', 'custom:church': 'opt_in' }
    })
  })

  it('deletes nothing and can run twice', async () => {
    const { orgId } = await createSite(env)
    const campaignId = await createCampaign(env, orgId, { endMode: 'none' })
    const email = testEmail(env)
    const sub = await praying(orgId, campaignId, email)
    const account = (await accountByEmail(env.admin, email))!
    await unsubscribeEverywhere(env.app, account.id, { capture })
    await unsubscribeEverywhere(env.app, account.id, { capture })
    const state = await stateOf(orgId, sub.subscriptionId, sub.contactId)
    expect(state.status).toBe('unsubscribed')
    expect(state.reminders).toHaveLength(1)
    const revokes = await withOrg(env.app, orgId, async (tx) => {
      const ch = (await primaryEmailOf(tx, sub.contactId))!
      return await tx.selectFrom('crm_consent_events').select('purpose').where('channel_id', '=', ch.channelId).where('event', '=', 'revoke').execute()
    })
    expect(revokes).toHaveLength(2)
  })
})
