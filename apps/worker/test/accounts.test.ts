import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { withOrg } from '@prayertools/shared/db/scope'
import { accountByEmail, deleteAccountIfUnused, syncAccountContacts } from '@prayertools/shared/accounts'
import { primaryEmailOf, setConsent } from '@prayertools/shared/crm'
import { createWebSignup, verifySubscription } from '@prayertools/shared/subscriptions'
import { syncLinkedContacts } from '../src/daily/accounts'
import { cleanup, closeEnv, createCampaign, createSite, createSubscriber, testCtx, testEmail, testEnv, uid, type TestEnv } from './helpers'

let env: TestEnv
beforeAll(() => { env = testEnv() })
afterEach(async () => { await cleanup(env) })
afterAll(async () => { await closeEnv(env) })

// A verified web signup on the RLS connection, as the public server makes it.
async function signUp(orgId: string, campaignId: string, email: string) {
  return await withOrg(env.app, orgId, async (tx) => {
    const campaign = await tx.selectFrom('pt_campaign').selectAll().where('id', '=', campaignId).executeTakeFirstOrThrow()
    const res = await createWebSignup(tx, { campaign, email, name: 'Ruth', language: 'en', timezone: 'UTC', commitments: [], consents: {}, preVerified: true, capture: { surface: 'test', source: 'test' } })
    return { subscriptionId: res.subscription.id, contactId: res.contactId }
  })
}

async function contactOf(orgId: string, contactId: string) {
  return await withOrg(env.app, orgId, async tx => ({
    row: await tx.selectFrom('crm_records').select(['name', 'user_id']).where('id', '=', contactId).executeTakeFirstOrThrow(),
    email: await primaryEmailOf(tx, contactId)
  }))
}

describe('accounts', () => {
  it('creates an unverified account at signup and links the subscription and contact once the address is verified', async () => {
    const { orgId } = await createSite(env)
    const campaignId = await createCampaign(env, orgId, { endMode: 'none' })
    const email = testEmail(env)
    const res = await withOrg(env.app, orgId, async (tx) => {
      const campaign = await tx.selectFrom('pt_campaign').selectAll().where('id', '=', campaignId).executeTakeFirstOrThrow()
      return await createWebSignup(tx, { campaign, email, name: 'Ruth', language: 'en', timezone: 'UTC', commitments: [], consents: {}, capture: { surface: 'test', source: 'test' } })
    })
    let account = await accountByEmail(env.admin, email)
    expect(account).toMatchObject({ id: res.userId, verified: false, display_name: 'Ruth' })
    expect(res.subscription.user_id).toBeNull()
    expect((await contactOf(orgId, res.contactId)).row.user_id).toBeNull()

    const verified = await withOrg(env.app, orgId, tx => verifySubscription(tx, res.verifyToken!))
    account = await accountByEmail(env.admin, email)
    expect(account!.verified).toBe(true)
    expect(verified!.user_id).toBe(account!.id)
    expect((await contactOf(orgId, res.contactId)).row.user_id).toBe(account!.id)
  })

  it('gives the same address one account across sites and copies its name and address to every contact', async () => {
    const a = await createSite(env)
    const b = await createSite(env)
    const email = testEmail(env)
    const subA = await signUp(a.orgId, await createCampaign(env, a.orgId, { endMode: 'none' }), email)
    const subB = await signUp(b.orgId, await createCampaign(env, b.orgId, { endMode: 'none' }), email)
    const account = (await accountByEmail(env.admin, email))!
    expect((await contactOf(a.orgId, subA.contactId)).row.user_id).toBe(account.id)
    expect((await contactOf(b.orgId, subB.contactId)).row.user_id).toBe(account.id)

    await withOrg(env.app, a.orgId, async (tx) => {
      const ch = await primaryEmailOf(tx, subA.contactId)
      await setConsent(tx, ch!.channelId, 'site_updates', true, { wording: { key: 'consent.site_updates' }, surface: 'test', source: 'test' })
    })
    const next = `n-${uid()}@test.example`
    env.emails.push(next)
    await env.admin.updateTable('users').set({ display_name: 'Ruth Moabite', email: next }).where('id', '=', account.id).execute()
    await syncAccountContacts(env.app, [a.orgId, b.orgId], { ...account, display_name: 'Ruth Moabite', email: next })

    for (const [orgId, contactId] of [[a.orgId, subA.contactId], [b.orgId, subB.contactId]] as const) {
      const c = await contactOf(orgId, contactId)
      expect(c.row.name).toBe('Ruth Moabite')
      expect(c.email?.email).toBe(next)
      expect(c.email?.verified).toBe(true)
    }
    const consent = await withOrg(env.app, a.orgId, async (tx) => {
      const ch = await primaryEmailOf(tx, subA.contactId)
      const old = await tx.selectFrom('crm_channels').select('id').where('normalized_value', '=', email).execute()
      return { granted: await tx.selectFrom('crm_channel_consents').select('status').where('channel_id', '=', ch!.channelId).where('purpose', '=', 'site_updates').executeTakeFirst(), old }
    })
    expect(consent.granted?.status).toBe('opt_in')
    expect(consent.old).toHaveLength(0)
  })

  it('catches up contacts whose account changed elsewhere', async () => {
    const { orgId } = await createSite(env)
    const email = testEmail(env)
    const sub = await createSubscriber(env, orgId, await createCampaign(env, orgId, { endMode: 'none' }), { email })
    const account = (await accountByEmail(env.admin, email))!
    await env.admin.updateTable('users').set({ display_name: 'Naomi' }).where('id', '=', account.id).execute()
    const ctx = testCtx(env)
    expect((await syncLinkedContacts(ctx, ctx.log)).synced).toBeGreaterThanOrEqual(1)
    expect((await contactOf(orgId, sub.contactId)).row.name).toBe('Naomi')
  })

  it('deletes an account only when nothing uses it', async () => {
    const { orgId } = await createSite(env)
    const email = testEmail(env)
    const sub = await createSubscriber(env, orgId, await createCampaign(env, orgId, { endMode: 'none' }), { email })
    const account = (await accountByEmail(env.admin, email))!
    expect(await env.admin.transaction().execute(tx => deleteAccountIfUnused(tx, account.id))).toBe(false)
    await withOrg(env.admin, orgId, async (tx) => {
      await tx.deleteFrom('pt_subscription').where('id', '=', sub.subscriptionId).execute()
      await tx.updateTable('crm_records').set({ user_id: null }).where('id', '=', sub.contactId).execute()
    })
    await env.admin.insertInto('memberships').values({ user_id: account.id, org_id: orgId }).execute()
    expect(await env.admin.transaction().execute(tx => deleteAccountIfUnused(tx, account.id))).toBe(false)
    await env.admin.deleteFrom('memberships').where('user_id', '=', account.id).execute()
    expect(await env.admin.transaction().execute(tx => deleteAccountIfUnused(tx, account.id))).toBe(true)
  })
})
