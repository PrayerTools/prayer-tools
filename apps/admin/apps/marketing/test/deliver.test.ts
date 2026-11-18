import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'kysely'
import { withOrg } from '@prayertools/shared/db/scope'
import { suppress } from '@prayertools/shared/email/suppression'
import { materialize, processMarketing } from '../lib/deliver'
import { asUser } from '../lib/db'
import { scheduleParent } from '../lib/multi'
import { addPerson, captureHost, cleanup, closeEnv, createEmail, createSite, createUser, deliveries, emailRow, testEnv, useInboxDomain, versions, type TestEnv } from './helpers'

let env: TestEnv
beforeAll(() => {
  env = testEnv()
})
afterEach(async () => {
  await cleanup(env)
})
afterAll(async () => {
  await closeEnv(env)
})

function run(host: ReturnType<typeof captureHost>, now = new Date(), limit?: number) {
  return processMarketing({ adminDb: env.admin, appDb: env.app, host, now, limit, log: () => {} })
}

describe('single-site send', () => {
  it('materializes the audience, skips people without consent or suppressed, and sends the rest once', async () => {
    const site = await createSite(env, 'City Prays')
    const a = await addPerson(env, site, { name: 'Amira Haddad' })
    const fr = await addPerson(env, site, { language: 'fr', name: 'Jean Dupont' })
    const noConsent = await addPerson(env, site, { consent: false })
    const suppressed = await addPerson(env, site)
    const unverified = await addPerson(env, site, { verified: false })
    const notInCampaign = await addPerson(env, site, { commitment: false })
    await suppress(env.admin, suppressed.email, 'complaint', null, 'test')
    const emailId = await createEmail(env, site.orgId)
    const host = captureHost()

    const res = await run(host)
    expect(res.started).toBeGreaterThanOrEqual(1)
    const to = host.mails.map(m => m.to).sort()
    expect(to).toEqual([a.email, fr.email].sort())
    expect(host.mails.find(m => m.to === unverified.email)).toBeUndefined()
    expect(host.mails.find(m => m.to === notInCampaign.email)).toBeUndefined()

    const rows = await deliveries(env, site.orgId, emailId)
    expect(rows).toHaveLength(4)
    expect(rows.find(r => r.channel_id === noConsent.channelId)).toMatchObject({ status: 'skipped', skip_reason: 'no_consent' })
    expect(rows.find(r => r.channel_id === suppressed.channelId)).toMatchObject({ status: 'skipped', skip_reason: 'suppressed' })
    expect(rows.filter(r => r.status === 'sent').every(r => r.address === null)).toBe(true)

    const mail = host.mails.find(m => m.to === a.email)!
    expect(mail.subject).toBe('Hello Amira')
    expect(mail.text).toContain('News from City Prays: Lent')
    expect(mail.text).toContain(`http://${site.slug}.localhost:3380`)
    expect(mail.html).toContain('A short note')
    expect(mail.unsubscribeUrl).toMatch(/^http:\/\/localhost:2380\/api\/marketing\/unsubscribe\?token=/)
    expect(mail.html).toContain('http://localhost:2380/marketing/unsubscribe/')
    expect(mail.orgId).toBe(site.orgId)
    expect(mail.ref).toBeTruthy()
    expect(mail.fromLocal).toBe(site.slug)
    expect(host.mails.find(m => m.to === fr.email)!.subject).toBe('Bonjour Jean')

    expect(await emailRow(env, site.orgId, emailId)).toMatchObject({ status: 'sent', recipients: 4, sent: 2, skipped: 2, failed: 0 })

    await run(host)
    expect(host.mails).toHaveLength(2)
  })

  it('never duplicates deliveries when materialized twice and fails a claim left behind by a crash', async () => {
    const site = await createSite(env)
    await addPerson(env, site)
    await addPerson(env, site)
    const emailId = await createEmail(env, site.orgId, { status: 'draft' })
    const host = captureHost()
    await withOrg(env.app, site.orgId, async (tx) => {
      const email = { id: emailId, org_id: site.orgId, parent_id: null, audiences: [`campaign:${site.campaignId}`, 'consented_updates'] }
      await materialize(host, tx as never, email)
      await materialize(host, tx as never, email)
    })
    let rows = await deliveries(env, site.orgId, emailId)
    expect(rows).toHaveLength(2)

    await withOrg(env.app, site.orgId, tx => sql`UPDATE marketing_delivery SET claimed_at = now() - interval '1 hour', attempts = 1 WHERE email_id = ${emailId} AND id = (SELECT min(id::text)::uuid FROM marketing_delivery WHERE email_id = ${emailId})`.execute(tx))
    await withOrg(env.app, site.orgId, tx => sql`UPDATE marketing_email SET status = 'sending', started_at = now() WHERE id = ${emailId}`.execute(tx))
    await run(host)
    rows = await deliveries(env, site.orgId, emailId)
    expect(rows.filter(r => r.status === 'failed')).toHaveLength(1)
    expect(rows.find(r => r.status === 'failed')!.error).toContain('Interrupted')
    expect(host.mails).toHaveLength(1)
    expect(await emailRow(env, site.orgId, emailId)).toMatchObject({ status: 'sent', sent: 1, failed: 1 })
  })

  it('retries a retryable provider failure and gives up after three attempts', async () => {
    const site = await createSite(env)
    await addPerson(env, site)
    const emailId = await createEmail(env, site.orgId)
    const host = captureHost({
      send: async () => {
        throw Object.assign(new Error('Mailgun 503'), { retryable: true })
      }
    })
    const r1 = await run(host)
    expect(r1.retried).toBe(1)
    await run(host)
    const r3 = await run(host)
    expect(r3.failed).toBe(1)
    const rows = await deliveries(env, site.orgId, emailId)
    expect(rows[0]).toMatchObject({ status: 'failed', attempts: 3 })
    expect(await emailRow(env, site.orgId, emailId)).toMatchObject({ status: 'sent', failed: 1 })
  })

  it('throttles each site per minute', async () => {
    const site = await createSite(env)
    for (let i = 0; i < 5; i++) await addPerson(env, site)
    const emailId = await createEmail(env, site.orgId)
    const host = captureHost({ throttlePerMinute: () => 2 })
    const now = new Date()
    await run(host, now)
    expect(host.mails).toHaveLength(2)
    await run(host, new Date(now.getTime() + 10_000))
    expect(host.mails).toHaveLength(2)
    await run(host, new Date(now.getTime() + 61_000))
    expect(host.mails).toHaveLength(4)
    await run(host, new Date(now.getTime() + 122_000))
    expect(host.mails).toHaveLength(5)
    expect((await emailRow(env, site.orgId, emailId)).status).toBe('sent')
  })

  it('pauses a site\'s sends when its complaint rate is too high', async () => {
    const site = await createSite(env)
    await addPerson(env, site)
    const emailId = await createEmail(env, site.orgId)
    const host = captureHost({ complaintCount: async () => 5 })
    const res = await run(host)
    expect(res.paused).toBeGreaterThanOrEqual(1)
    expect(host.mails).toHaveLength(0)
    expect(await emailRow(env, site.orgId, emailId)).toMatchObject({ status: 'paused', paused_reason: 'complaint_rate' })
  })

  it('stops sending when the email is cancelled', async () => {
    const site = await createSite(env)
    await addPerson(env, site)
    await addPerson(env, site)
    const emailId = await createEmail(env, site.orgId)
    const host = captureHost({ throttlePerMinute: () => 1 })
    await run(host)
    expect(host.mails).toHaveLength(1)
    const { cancelEmail } = await import('../lib/deliver')
    await withOrg(env.app, site.orgId, tx => cancelEmail(tx as never, emailId))
    await run(host, new Date(Date.now() + 61_000))
    expect(host.mails).toHaveLength(1)
    expect(await emailRow(env, site.orgId, emailId)).toMatchObject({ status: 'cancelled', sent: 1, skipped: 1 })
  })
})

describe('multi-site send', () => {
  it('sends each person one email, from the most recently joined chosen site where they consented', async () => {
    const user = await createUser(env)
    const s1 = await createSite(env, 'First site')
    const s2 = await createSite(env, 'Second site')
    const s3 = await createSite(env, 'Third site')
    const shared = `shared-${Date.now()}@test.example`
    const t = Date.now()
    await addPerson(env, s1, { email: shared, joinedAt: new Date(t - 3 * 86_400_000) })
    await addPerson(env, s2, { email: shared, joinedAt: new Date(t - 2 * 86_400_000) })
    await addPerson(env, s3, { email: shared, joinedAt: new Date(t - 86_400_000), consent: false })
    const only1 = await addPerson(env, s1)
    const only3 = await addPerson(env, s3)

    const parent = await env.admin.insertInto('marketing_parent' as never).values({
      owner_user_id: user,
      versions: sql`${JSON.stringify(versions())}::text::jsonb`,
      source_language: 'en',
      org_ids: sql`${`{${[s1.orgId, s2.orgId, s3.orgId].join(',')}}`}::uuid[]`,
      audiences: sql`'{consented_updates}'::text[]`
    } as never).returning('id' as never).executeTakeFirstOrThrow() as { id: string }
    expect(await asUser(env.app as never, user, tx => scheduleParent(tx, parent.id, user, new Date(Date.now() - 1000)))).toBe(true)

    const host = captureHost()
    const res = await run(host)
    expect(res.resolvedParents).toBe(1)
    expect(host.mails.filter(m => m.to === shared)).toHaveLength(1)
    expect(host.mails.find(m => m.to === shared)!.orgId).toBe(s2.orgId)
    expect(host.mails.find(m => m.to === shared)!.text).toContain('Second site')
    expect(host.mails.filter(m => m.to === only1.email)).toHaveLength(1)
    expect(host.mails.find(m => m.to === only1.email)!.orgId).toBe(s1.orgId)
    expect(host.mails.filter(m => m.to === only3.email)).toHaveLength(1)
    expect(host.mails).toHaveLength(3)

    const p = await sql<{ status: string, people: number, sent: number }>`SELECT status, people, sent FROM marketing_parent WHERE id = ${parent.id}`.execute(env.admin)
    expect(p.rows[0]).toMatchObject({ status: 'sent', people: 3, sent: 3 })
    const fps = await sql<{ fingerprint: string }>`SELECT fingerprint FROM marketing_parent_recipient WHERE parent_id = ${parent.id}`.execute(env.admin)
    expect(fps.rows.every(r => /^[0-9a-f]{64}$/.test(r.fingerprint))).toBe(true)

    await run(host)
    expect(host.mails).toHaveLength(3)
  })

  it('sends each site\'s campaign audience from that site only', async () => {
    const user = await createUser(env)
    const s1 = await createSite(env, 'First site')
    const s2 = await createSite(env, 'Second site')
    const p1 = await addPerson(env, s1)
    const p2 = await addPerson(env, s2)
    const outside = await addPerson(env, s2, { commitment: false })

    const parent = await env.admin.insertInto('marketing_parent' as never).values({
      owner_user_id: user,
      versions: sql`${JSON.stringify(versions())}::text::jsonb`,
      source_language: 'en',
      org_ids: sql`${`{${[s1.orgId, s2.orgId].join(',')}}`}::uuid[]`,
      audiences: sql`${`{campaign:${s1.campaignId},campaign:${s2.campaignId}}`}::text[]`
    } as never).returning('id' as never).executeTakeFirstOrThrow() as { id: string }
    expect(await asUser(env.app as never, user, tx => scheduleParent(tx, parent.id, user, new Date(Date.now() - 1000)))).toBe(true)

    const host = captureHost()
    await run(host)
    expect(host.mails.map(m => [m.to, m.orgId]).sort()).toEqual([[p1.email, s1.orgId], [p2.email, s2.orgId]].sort())
    expect(host.mails.find(m => m.to === outside.email)).toBeUndefined()
  })
})

describe('recipient check', () => {
  it('refuses an email with a delivery to another site\'s address, before anything is sent', async () => {
    const a = await createSite(env, 'Site A')
    const b = await createSite(env, 'Site B')
    const mine = await addPerson(env, a)
    const theirs = await addPerson(env, b)
    const emailId = await createEmail(env, a.orgId)
    const host = captureHost()
    // Start it without sending, then plant a delivery to site B's person.
    await run(host, new Date(), 0)
    expect(host.mails).toHaveLength(0)
    await sql`
      INSERT INTO marketing_delivery (org_id, email_id, channel_id, address, language, purpose, status)
      VALUES (${a.orgId}, ${emailId}, ${theirs.channelId}, ${theirs.email}, 'en', 'site_updates', 'pending')
    `.execute(env.admin)

    const res = await run(host)
    expect(res.refused).toBe(1)
    expect(host.mails).toHaveLength(0)
    expect(await emailRow(env, a.orgId, emailId)).toMatchObject({ status: 'failed', failed_reason: 'recipient_check' })
    const rows = await deliveries(env, a.orgId, emailId)
    expect(rows.find(r => r.channel_id === mine.channelId)).toMatchObject({ status: 'skipped', skip_reason: 'recipient_check' })
  })

  it('lets a site\'s own send through', async () => {
    const a = await createSite(env)
    await addPerson(env, a)
    await createEmail(env, a.orgId)
    const host = captureHost()
    const res = await run(host)
    expect(res.refused).toBe(0)
    expect(host.mails).toHaveLength(1)
  })
})

describe('suppressions', () => {
  it('lets a complaint on another site leave this site\'s mail alone', async () => {
    const site = await createSite(env)
    const other = await createSite(env)
    const p = await addPerson(env, site)
    await suppress(env.admin, p.email, 'complaint', null, 'test', other.orgId)
    await createEmail(env, site.orgId)
    const host = captureHost()
    await run(host)
    expect(host.mails.map(m => m.to)).toEqual([p.email])
  })

  it('skips a delivery the mail kernel finds suppressed at send time', async () => {
    const site = await createSite(env)
    const p = await addPerson(env, site)
    const emailId = await createEmail(env, site.orgId)
    await run(captureHost({ send: async () => ({ status: 'suppressed' as const }) }))
    const rows = await deliveries(env, site.orgId, emailId)
    expect(rows.find(r => r.channel_id === p.channelId)).toMatchObject({ status: 'skipped', skip_reason: 'suppressed' })
    expect(await emailRow(env, site.orgId, emailId)).toMatchObject({ sent: 0, skipped: 1, failed: 0 })
  })
})

describe('reply-to', () => {
  it('goes to the site\'s inbox when the site sets none', async () => {
    await useInboxDomain(env)
    const site = await createSite(env)
    await withOrg(env.app, site.orgId, tx => tx.updateTable('pt_site').set({ email_identity: sql`'{}'::jsonb` }).execute())
    await addPerson(env, site)
    await createEmail(env, site.orgId)
    const host = captureHost()
    await run(host)
    expect(host.mails[0]!.replyTo).toBe(`${site.slug}@inbox.test`)
  })
})
