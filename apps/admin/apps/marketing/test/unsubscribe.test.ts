import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'kysely'
import { processMarketing } from '../lib/deliver'
import { asUser } from '../lib/db'
import { scheduleParent } from '../lib/multi'
import { signToken, UNSUBSCRIBE_TOKEN_DAYS, verifyToken } from '../lib/tokens'
import { applyUnsubscribe, describeUnsubscribe } from '../lib/unsubscribe'
import { addPerson, captureHost, cleanup, closeEnv, consentOf, createEmail, createSite, createUser, emailRow, testEnv, versions, type TestEnv } from './helpers'

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

const capture = { source: 'marketing-unsubscribe', surface: 'email', ip: '203.0.113.9', userAgent: 'test' }

function tokenOf(url: string | null): string {
  return decodeURIComponent(new URL(url!).searchParams.get('token')!)
}

describe('unsubscribe', () => {
  it('withdraws the audience purpose on the site, once, and counts it on the email', async () => {
    const site = await createSite(env, 'City Prays')
    const p = await addPerson(env, site)
    const other = await addPerson(env, site)
    const emailId = await createEmail(env, site.orgId)
    const host = captureHost()
    await processMarketing({ adminDb: env.admin, appDb: env.app, host, log: () => {} })
    const token = tokenOf(host.mails.find(m => m.to === p.email)!.unsubscribeUrl)

    const info = await describeUnsubscribe(host, env.app as never, token)
    expect(info).toMatchObject({ test: false, sites: [{ id: site.orgId, name: 'City Prays' }] })
    expect(info!.address).not.toContain(p.email.split('@')[0])

    const res = await applyUnsubscribe(host, env.app as never, token, capture)
    expect(res).toMatchObject({ withdrawn: 1, sites: [site.orgId] })
    const c = await consentOf(env, site.orgId, p.channelId)
    expect(c.status).toBe('opt_out')
    expect(c.events.map(e => e.event)).toEqual(['grant', 'revoke'])
    expect(c.events[1]).toMatchObject({ source: 'marketing-unsubscribe' })
    expect((c.events[1]!.meta as Record<string, unknown>).surface).toBe('email')
    expect((await consentOf(env, site.orgId, other.channelId)).status).toBe('opt_in')

    const again = await applyUnsubscribe(host, env.app as never, token, capture)
    expect(again!.withdrawn).toBe(0)
    expect((await consentOf(env, site.orgId, p.channelId)).events).toHaveLength(2)
    expect((await emailRow(env, site.orgId, emailId)).unsubscribes).toBe(1)

    // Reminders are untouched: the subscription stays active.
    const sub = await sql<{ status: string }>`SELECT status FROM pt_subscription WHERE contact_id = ${p.contactId}`.execute(env.admin)
    expect(sub.rows[0]!.status).toBe('active')
  })

  it('names a delivery, not an address, and rejects tampered or expired tokens', async () => {
    const site = await createSite(env)
    const p = await addPerson(env, site)
    await createEmail(env, site.orgId)
    const host = captureHost()
    await processMarketing({ adminDb: env.admin, appDb: env.app, host, log: () => {} })
    const good = tokenOf(host.mails.find(m => m.to === p.email)!.unsubscribeUrl)
    expect(Buffer.from(good.split('.')[0]!, 'base64url').toString('utf8')).not.toContain(p.email.split('@')[0])
    expect(await applyUnsubscribe(host, env.app as never, `${good}x`, capture)).toBeNull()

    const payload = JSON.parse(Buffer.from(good.split('.')[0]!, 'base64url').toString('utf8')) as { o: string, d: string }
    const expired = signToken({ o: payload.o, d: payload.d }, host.secret(), new Date(Date.now() - (UNSUBSCRIBE_TOKEN_DAYS + 1) * 86_400_000))
    expect(verifyToken(expired, host.secret())).toBeNull()
    expect(await applyUnsubscribe(host, env.app as never, expired, capture)).toBeNull()
    expect((await consentOf(env, site.orgId, p.channelId)).status).toBe('opt_in')

    const test = signToken({ o: site.orgId, t: true }, host.secret())
    expect(await applyUnsubscribe(host, env.app as never, test, capture)).toMatchObject({ test: true, withdrawn: 0 })
    expect((await consentOf(env, site.orgId, p.channelId)).status).toBe('opt_in')

    expect(await applyUnsubscribe(host, env.app as never, good, capture)).toMatchObject({ withdrawn: 1 })
  })

  it('from a multi-site send, withdraws updates on every chosen site the person belongs to', async () => {
    const user = await createUser(env)
    const s1 = await createSite(env, 'First site')
    const s2 = await createSite(env, 'Second site')
    const s3 = await createSite(env, 'Not chosen')
    const email = `multi-${Date.now()}@test.example`
    const a = await addPerson(env, s1, { email, joinedAt: new Date(Date.now() - 2 * 86_400_000) })
    const b = await addPerson(env, s2, { email, joinedAt: new Date(Date.now() - 86_400_000) })
    const c = await addPerson(env, s3, { email })

    const parent = await sql<{ id: string }>`
      INSERT INTO marketing_parent (owner_user_id, versions, source_language, org_ids, audiences)
      VALUES (${user}, ${JSON.stringify(versions())}::text::jsonb, 'en', ${`{${s1.orgId},${s2.orgId}}`}::uuid[], '{consented_updates}')
      RETURNING id
    `.execute(env.admin)
    const parentId = parent.rows[0]!.id
    await asUser(env.app as never, user, tx => scheduleParent(tx, parentId, user, new Date(Date.now() - 1000)))
    const host = captureHost()
    await processMarketing({ adminDb: env.admin, appDb: env.app, host, log: () => {} })
    const mine = host.mails.filter(m => m.to === email)
    expect(mine).toHaveLength(1)
    expect(mine[0]!.orgId).toBe(s2.orgId)

    const token = tokenOf(mine[0]!.unsubscribeUrl)
    const info = await describeUnsubscribe(host, env.app as never, token)
    expect(info!.sites.map(s => s.name).sort()).toEqual(['First site', 'Second site'])

    const res = await applyUnsubscribe(host, env.app as never, token, capture)
    expect(res!.sites.sort()).toEqual([s1.orgId, s2.orgId].sort())
    for (const [site, person] of [[s1, a], [s2, b]] as const) {
      const state = await consentOf(env, site.orgId, person.channelId)
      expect(state.status).toBe('opt_out')
      expect(state.events.filter(e => e.event === 'revoke')).toHaveLength(1)
    }
    expect((await consentOf(env, s3.orgId, c.channelId)).status).toBe('opt_in')
    // The worker totals the send's unsubscribes from its site emails, also after it finished.
    await processMarketing({ adminDb: env.admin, appDb: env.app, host, log: () => {} })
    const p = await sql<{ unsubscribes: number }>`SELECT unsubscribes FROM marketing_parent WHERE id = ${parentId}`.execute(env.admin)
    expect(p.rows[0]!.unsubscribes).toBe(1)
  })
})
