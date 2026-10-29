import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { withOrg } from '@prayertools/shared/db/scope'
import { accountByEmail, deleteAccountIfUnused, syncAccountContacts } from '@prayertools/shared/accounts'
import { primaryEmailOf, setConsent } from '@prayertools/shared/crm'
import { createWebSignup, verifySubscription } from '@prayertools/shared/subscriptions'
import { syncLinkedContacts } from '../src/daily/accounts'
import { deleteUnusedAccounts, expireIdleDevices } from '../src/daily/retention'
import { DAY } from '../src/util'
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
  it('creates the account only once the address is verified, then links the subscription and contact', async () => {
    const { orgId } = await createSite(env)
    const campaignId = await createCampaign(env, orgId, { endMode: 'none' })
    const email = testEmail(env)
    const res = await withOrg(env.app, orgId, async (tx) => {
      const campaign = await tx.selectFrom('pt_campaign').selectAll().where('id', '=', campaignId).executeTakeFirstOrThrow()
      return await createWebSignup(tx, { campaign, email, name: 'Ruth', language: 'en', timezone: 'UTC', commitments: [], consents: {}, capture: { surface: 'test', source: 'test' } })
    })
    let account = await accountByEmail(env.admin, email)
    expect(account).toBeNull()
    expect(res.userId).toBeNull()
    expect(res.subscription.user_id).toBeNull()
    expect((await contactOf(orgId, res.contactId)).row.user_id).toBeNull()

    const verified = await withOrg(env.app, orgId, tx => verifySubscription(tx, res.verifyToken!))
    account = await accountByEmail(env.admin, email)
    expect(account).toMatchObject({ verified: true, display_name: 'Ruth' })
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

  it('clears a password nobody proved once the address is proved through prayer.tools', async () => {
    const { orgId } = await createSite(env)
    const email = testEmail(env)
    const created = await env.admin.insertInto('users').values({ email, display_name: 'Squatter', password: 'hash', verified: false }).returning('id').executeTakeFirstOrThrow()
    await env.admin.insertInto('sessions').values({ user_id: created.id, client: 'web', refresh_token_hash: uid(), expires_at: new Date(Date.now() + DAY) } as never).execute()
    await createSubscriber(env, orgId, await createCampaign(env, orgId, { endMode: 'none' }), { email })
    const row = await env.admin.selectFrom('users').select(['verified', 'password']).where('id', '=', created.id).executeTakeFirstOrThrow()
    expect(row).toEqual({ verified: true, password: null })
    expect(await env.admin.selectFrom('sessions').select('id').where('user_id', '=', created.id).execute()).toHaveLength(0)
  })

  it('does not name an account from an unverified signup', async () => {
    const { orgId } = await createSite(env)
    const campaignId = await createCampaign(env, orgId, { endMode: 'none' })
    const email = testEmail(env)
    await withOrg(env.app, orgId, async (tx) => {
      const campaign = await tx.selectFrom('pt_campaign').selectAll().where('id', '=', campaignId).executeTakeFirstOrThrow()
      await createWebSignup(tx, { campaign, email, name: '', language: 'en', timezone: 'UTC', commitments: [], consents: {}, preVerified: true, capture: { surface: 'test', source: 'test' } })
    })
    const other = await createSite(env)
    const otherCampaignId = await createCampaign(env, other.orgId, { endMode: 'none' })
    await withOrg(env.app, other.orgId, async (tx) => {
      const campaign = await tx.selectFrom('pt_campaign').selectAll().where('id', '=', otherCampaignId).executeTakeFirstOrThrow()
      await createWebSignup(tx, { campaign, email, name: 'Impostor', language: 'en', timezone: 'UTC', commitments: [], consents: {}, capture: { surface: 'test', source: 'test' } })
    })
    expect((await accountByEmail(env.admin, email))!.display_name).toBe('')
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

  it('does not count a contact as due again once its trimmed name matches', async () => {
    const { orgId } = await createSite(env)
    const email = testEmail(env)
    const sub = await createSubscriber(env, orgId, await createCampaign(env, orgId, { endMode: 'none' }), { email })
    const account = (await accountByEmail(env.admin, email))!
    await env.admin.updateTable('users').set({ display_name: `  ${'N'.repeat(250)}  ` }).where('id', '=', account.id).execute()
    const ctx = testCtx(env)
    await syncLinkedContacts(ctx, ctx.log)
    expect((await contactOf(orgId, sub.contactId)).row.name).toBe('N'.repeat(200))
    expect((await syncLinkedContacts(ctx, ctx.log)).synced).toBe(0)
  })

  it('expires idle app devices and removes the anonymous account they leave, keeping its subscription', async () => {
    const { orgId } = await createSite(env)
    const old = new Date(Date.now() - 400 * DAY)
    const install = async (lastSeen: Date) => {
      const user = await env.admin.insertInto('users').values({ email: null, display_name: '', created: old }).returning('id').executeTakeFirstOrThrow()
      env.accounts.push(user.id)
      await env.admin.insertInto('pt_user_device').values({ user_id: user.id, credential_hash: uid(), created_at: old, last_seen_at: lastSeen }).execute()
      const sub = await withOrg(env.admin, orgId, tx => tx.insertInto('pt_subscription').values({ user_id: user.id, delivery: 'app', language: 'en', timezone: 'UTC', referral_code: uid().slice(0, 6) }).returning('id').executeTakeFirstOrThrow())
      return { userId: user.id, subscriptionId: sub.id }
    }
    const gone = await install(old)
    const kept = await install(new Date())
    const ctx = testCtx(env)
    expect(await expireIdleDevices(ctx, ctx.log)).toMatchObject({ devices: 1, released: 1 })
    await deleteUnusedAccounts(ctx)
    const users = await env.admin.selectFrom('users').select('id').where('id', 'in', [gone.userId, kept.userId]).execute()
    expect(users.map(u => u.id)).toEqual([kept.userId])
    const subs = await withOrg(env.admin, orgId, tx => tx.selectFrom('pt_subscription').select(['id', 'user_id']).where('id', 'in', [gone.subscriptionId, kept.subscriptionId]).orderBy('created_at').execute())
    expect(subs).toHaveLength(2)
    expect(subs.find(r => r.id === gone.subscriptionId)!.user_id).toBeNull()
    expect(subs.find(r => r.id === kept.subscriptionId)!.user_id).toBe(kept.userId)
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
    await env.admin.insertInto('user_identities').values({ user_id: account.id, provider: 'google', subject: uid() }).execute()
    expect(await env.admin.transaction().execute(tx => deleteAccountIfUnused(tx, account.id))).toBe(false)
    await env.admin.deleteFrom('user_identities').where('user_id', '=', account.id).execute()
    expect(await env.admin.transaction().execute(tx => deleteAccountIfUnused(tx, account.id))).toBe(true)
  })
})
