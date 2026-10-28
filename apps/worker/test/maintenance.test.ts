import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'kysely'
import { withOrg } from '@prayertools/shared/db/scope'
import { createAnonymousAccount } from '@prayertools/shared/accounts'
import { jsonb } from '@prayertools/shared/db/json'
import { addDays, todayIn } from '@prayertools/shared/dates'
import { ANONYMIZED_NAME } from '@prayertools/shared/subscriptions'
import type { HostnameStatus } from '@prayertools/shared/cloudflare'
import { runRetention, partitionCutoff } from '../src/daily/retention'
import { checkDomains } from '../src/daily/domains'
import { refreshStats } from '../src/daily/stats'
import { drainJobs } from '../src/jobs/processor'
import { addCommitment, cleanup, closeEnv, createCampaign, createSite, createSubscriber, mailsTo, testCtx, testEnv, uid, type TestEnv } from './helpers'
import { DAY } from '../src/util'

let env: TestEnv
beforeAll(() => { env = testEnv() })
afterEach(async () => { await cleanup(env) })
afterAll(async () => { await closeEnv(env) })

const TZ = 'America/New_York'

describe('data retention', () => {
  it('anonymizes subscriptions unsubscribed for 12 months and deletes their unused account', async () => {
    const { orgId } = await createSite(env)
    const campaignId = await createCampaign(env, orgId, { endMode: 'none' })
    const old = await createSubscriber(env, orgId, campaignId)
    const recent = await createSubscriber(env, orgId, campaignId)
    await addCommitment(env, orgId, old.subscriptionId, campaignId, { startsOn: '2025-01-01' })
    await withOrg(env.admin, orgId, async (tx) => {
      await tx.updateTable('pt_subscription').set({ status: 'unsubscribed', unsubscribed_at: new Date(Date.now() - 400 * DAY) }).where('id', '=', old.subscriptionId).execute()
      await tx.updateTable('pt_subscription').set({ status: 'unsubscribed', unsubscribed_at: new Date(Date.now() - 100 * DAY) }).where('id', '=', recent.subscriptionId).execute()
    })
    const oldSub = await withOrg(env.admin, orgId, tx => tx.selectFrom('pt_subscription').select('user_id').where('id', '=', old.subscriptionId).executeTakeFirstOrThrow())
    expect(oldSub.user_id).not.toBeNull()
    await env.admin.updateTable('users').set({ created: new Date(Date.now() - 500 * DAY) }).where('id', '=', oldSub.user_id!).execute()

    const ctx = testCtx(env)
    const res = await runRetention(ctx, ctx.log)
    expect(res.anonymized_unsubscribed).toBeGreaterThanOrEqual(1)

    const after = await withOrg(env.admin, orgId, async tx => ({
      sub: await tx.selectFrom('pt_subscription').selectAll().where('id', '=', old.subscriptionId).executeTakeFirstOrThrow(),
      contact: await tx.selectFrom('crm_records').selectAll().where('id', '=', old.contactId).executeTakeFirstOrThrow(),
      channels: await tx.selectFrom('crm_contact_channels').select('id').where('record_id', '=', old.contactId).execute(),
      address: await tx.selectFrom('crm_channels').select('id').where('normalized_value', '=', old.email).execute(),
      commitments: await tx.selectFrom('pt_commitment').select('id').where('subscription_id', '=', old.subscriptionId).execute(),
      consentValues: await tx.selectFrom('crm_consent_events').select('channel_value').where('channel_value', '=', old.email).execute(),
      recent: await tx.selectFrom('pt_subscription').selectAll().where('id', '=', recent.subscriptionId).executeTakeFirstOrThrow()
    }))
    expect(after.sub.anonymized_at).not.toBeNull()
    expect(after.sub.user_id).toBeNull()
    expect(after.contact.user_id).toBeNull()
    expect(after.sub.status).toBe('unsubscribed')
    expect(after.contact.name).toBe(ANONYMIZED_NAME)
    expect(after.contact.data).toEqual({})
    expect(after.channels).toHaveLength(0)
    expect(after.address).toHaveLength(0)
    expect(after.commitments).toHaveLength(0)
    expect(after.consentValues).toHaveLength(0)
    expect(after.recent.anonymized_at).toBeNull()
    const account = await env.admin.selectFrom('users').select('id').where('id', '=', oldSub.user_id!).executeTakeFirst()
    expect(account).toBeUndefined()
    // It still counts in the signup stats.
    const signups = await withOrg(env.admin, orgId, tx => tx.selectFrom('pt_stat_daily').select('value').where('metric', '=', 'signups').execute())
    expect(signups.reduce((n, r) => n + Number(r.value), 0)).toBe(2)
  })

  it('anonymizes every intercessor of a site archived for 12 months', async () => {
    const { orgId } = await createSite(env, { status: 'archived', archivedAt: new Date(Date.now() - 400 * DAY) })
    const campaignId = await createCampaign(env, orgId, { endMode: 'none' })
    const a = await createSubscriber(env, orgId, campaignId)
    const ctx = testCtx(env)
    await runRetention(ctx, ctx.log)
    const row = await withOrg(env.admin, orgId, async tx => ({
      sub: await tx.selectFrom('pt_subscription').select('anonymized_at').where('id', '=', a.subscriptionId).executeTakeFirstOrThrow(),
      site: await tx.selectFrom('pt_site').select('anonymized_at').executeTakeFirstOrThrow()
    }))
    expect(row.sub.anonymized_at).not.toBeNull()
    expect(row.site.anonymized_at).not.toBeNull()
  })

  it('drops raw events after 90 days, visitor days after 7, old session partitions, and expired account codes', async () => {
    const { orgId } = await createSite(env)
    await withOrg(env.admin, orgId, async (tx) => {
      await tx.insertInto('pt_event').values([
        { campaign_id: null, type: 'old', created_at: new Date(Date.now() - 100 * DAY) },
        { campaign_id: null, type: 'new', created_at: new Date(Date.now() - 10 * DAY) }
      ]).execute()
      await tx.insertInto('pt_stat_visitor_day').values([
        { day: addDays(todayIn('UTC'), -8), visitor_hash: 'a' },
        { day: todayIn('UTC'), visitor_hash: 'b' }
      ]).execute()
    })
    const userId = await createAnonymousAccount(env.admin)
    env.accounts.push(userId)
    await env.admin.updateTable('users').set({ created: new Date(Date.now() - 500 * DAY) }).where('id', '=', userId).execute()
    await env.admin.insertInto('pt_user_device').values({ user_id: userId, credential_hash: uid() }).execute()
    await env.admin.insertInto('pt_auth_code').values([
      { user_id: userId, purpose: 'sign_in', code_hash: uid(), expires_at: new Date(Date.now() - 2 * DAY) },
      { user_id: userId, purpose: 'sign_in', code_hash: uid(), expires_at: new Date(Date.now() + 3600_000) }
    ]).execute()
    await sql`CREATE TABLE IF NOT EXISTS pt_prayer_session_200001 PARTITION OF pt_prayer_session FOR VALUES FROM ('2000-01-01') TO ('2000-02-01')`.execute(env.admin)

    const ctx = testCtx(env)
    const res = await runRetention(ctx, ctx.log)
    expect(res.partitions_dropped).toBeGreaterThanOrEqual(1)
    const events = await withOrg(env.admin, orgId, tx => tx.selectFrom('pt_event').select('type').execute())
    expect(events.map(e => e.type)).toEqual(['new'])
    const days = await withOrg(env.admin, orgId, tx => tx.selectFrom('pt_stat_visitor_day').select('visitor_hash').execute())
    expect(days.map(d => d.visitor_hash)).toEqual(['b'])
    const part = await sql<{ r: string | null }>`select to_regclass('pt_prayer_session_200001')::text as r`.execute(env.admin)
    expect(part.rows[0]!.r).toBeNull()
    const future = new Date()
    future.setUTCMonth(future.getUTCMonth() + 2)
    const ahead = `pt_prayer_session_${future.getUTCFullYear()}${String(future.getUTCMonth() + 1).padStart(2, '0')}`
    const exists = await sql<{ r: string | null }>`select to_regclass(${ahead})::text as r`.execute(env.admin)
    expect(exists.rows[0]!.r).toBe(ahead)
    const codes = await env.admin.selectFrom('pt_auth_code').select('id').where('user_id', '=', userId).execute()
    expect(codes).toHaveLength(1)
    // An account with a device is kept.
    expect(await env.admin.selectFrom('users').select('id').where('id', '=', userId).executeTakeFirst()).toBeDefined()
  })

  it('deletes signup requests nobody confirmed in time', async () => {
    const { orgId } = await createSite(env)
    const campaignId = await createCampaign(env, orgId, { endMode: 'none' })
    const sub = await createSubscriber(env, orgId, campaignId)
    await withOrg(env.admin, orgId, tx => tx.insertInto('pt_signup_request').values([
      { subscription_id: sub.subscriptionId, campaign_id: campaignId, token_hash: uid(), request: jsonb({ kept: false }), expires_at: new Date(Date.now() - 1000) },
      { subscription_id: sub.subscriptionId, campaign_id: campaignId, token_hash: uid(), request: jsonb({ kept: true }), expires_at: new Date(Date.now() + 3600_000) }
    ]).execute())

    const ctx = testCtx(env)
    const res = await runRetention(ctx, ctx.log)
    expect(res.signup_requests_deleted).toBeGreaterThanOrEqual(1)
    const left = await withOrg(env.admin, orgId, tx => tx.selectFrom('pt_signup_request').select('request').execute())
    expect(left.map(r => r.request)).toEqual([{ kept: true }])
  })

  it('computes the partition cutoff 24 months back', () => {
    expect(partitionCutoff(new Date('2026-09-28T00:00:00Z'))).toBe('202409')
    expect(partitionCutoff(new Date('2026-01-05T00:00:00Z'))).toBe('202401')
  })
})

describe('custom-domain health check', () => {
  it('activates, fails (alerting the admins once) and recovers', async () => {
    const { orgId, slug } = await createSite(env)
    const user = await env.admin.insertInto('users').values({ email: `owner-${uid()}@test.example`, display_name: 'Owner', created: new Date(), updated: new Date() }).returning(['id', 'email']).executeTakeFirstOrThrow()
    env.users.push(user.id)
    await env.admin.insertInto('memberships').values({ user_id: user.id, org_id: orgId, roles: sql`'{admin}'::text[]`, created_at: new Date(), updated_at: new Date() }).execute()
    const hostname = `pray-${uid()}.example.org`
    const domain = await env.admin.insertInto('pt_site_domain').values({ org_id: orgId, hostname }).returning('id').executeTakeFirstOrThrow()
    let next: HostnameStatus['status'] = 'active'
    const ctx = testCtx(env, { hostnameStatus: async (h: string) => ({ id: null, status: h === hostname ? next : 'pending', records: [], detail: 'mock' }) })
    const row = () => env.admin.selectFrom('pt_site_domain').selectAll().where('id', '=', domain.id).executeTakeFirstOrThrow()

    await checkDomains(ctx, ctx.log)
    let d = await row()
    expect(d.status).toBe('active')
    expect(d.activated_at).not.toBeNull()

    next = 'pending'
    await checkDomains(ctx, ctx.log)
    d = await row()
    expect(d.status).toBe('failing')
    expect(d.failing_since).not.toBeNull()
    expect(d.alerted_at).not.toBeNull()
    await checkDomains(ctx, ctx.log)
    const alerts = await env.admin.selectFrom('pt_job').select('id').where('type', '=', 'domain_alert').where('org_id', '=', orgId).execute()
    expect(alerts).toHaveLength(1)

    await drainJobs(ctx, ctx.log)
    const mail = mailsTo(ctx.mails, user.email!)
    expect(mail).toHaveLength(1)
    expect(mail[0]!.subject).toContain(hostname)
    expect(mail[0]!.text).toContain(`http://${slug}.localhost:3380`)

    next = 'active'
    await checkDomains(ctx, ctx.log)
    d = await row()
    expect(d.status).toBe('active')
    expect(d.failing_since).toBeNull()
    expect(d.alerted_at).toBeNull()
  })

  it('without a Cloudflare token checks DNS: a hostname with no CNAME stays pending', async () => {
    const { orgId } = await createSite(env)
    const hostname = `nothing-${uid()}.invalid`
    await env.admin.insertInto('pt_site_domain').values({ org_id: orgId, hostname }).execute()
    const ctx = testCtx(env)
    await checkDomains(ctx, ctx.log)
    const d = await env.admin.selectFrom('pt_site_domain').selectAll().where('hostname', '=', hostname).executeTakeFirstOrThrow()
    expect(d.status).toBe('pending')
    expect(d.last_checked_at).not.toBeNull()
    expect(d.verification).toMatchObject({ detail: 'no-cname' })
  })
})

describe('stats refresh', () => {
  it('updates the directory entry of an active site and caches coverage of a long 24/7 campaign', async () => {
    const { orgId, slug } = await createSite(env)
    const today = todayIn(TZ)
    const campaignId = await createCampaign(env, orgId, { name: 'Year of prayer', goal: 'coverage', startDate: addDays(today, -10), endDate: addDays(today, 80) })
    for (let i = 0; i < 2; i++) {
      const s = await createSubscriber(env, orgId, campaignId)
      await addCommitment(env, orgId, s.subscriptionId, campaignId, { startsOn: addDays(today, -10), endsOn: addDays(today, 80), time: i ? '10:00' : '09:00', durationMin: 30 })
    }
    await env.admin.insertInto('pt_directory_entry').values({ org_id: orgId, slug, name: 'Test', status: 'listed', updated_at: new Date() }).execute()
    const ctx = testCtx(env)
    await refreshStats(ctx, ctx.log)
    const entry = await env.admin.selectFrom('pt_directory_entry').selectAll().where('org_id', '=', orgId).executeTakeFirstOrThrow()
    expect(entry.people_count).toBe(2)
    expect(entry.campaign_name).toBe('Year of prayer')
    expect(entry.campaign_starts_on).toBe(addDays(today, -10))
    const cache = await withOrg(env.admin, orgId, tx => tx.selectFrom('pt_coverage_cache').selectAll().where('campaign_id', '=', campaignId).executeTakeFirstOrThrow())
    expect(cache.slots.length).toBeGreaterThan(90 * 90)
    expect(cache.slots.filter(n => n > 0).length).toBeGreaterThan(0)
  })
})
