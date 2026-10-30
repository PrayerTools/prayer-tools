// Fixtures for the marketing tests: prayer.tools sites with campaigns and
// verified intercessors, a capturing host, and cleanup of everything made.
import { randomBytes } from 'node:crypto'
import { sql } from 'kysely'
import { createDb } from '@prayertools/shared/db/connect'
import { withOrg, type Db } from '@prayertools/shared/db/scope'
import { jsonb } from '@prayertools/shared/db/json'
import { ensureSystemUser } from '@prayertools/shared/crm'
import { createWebSignup } from '@prayertools/shared/subscriptions'
import { emailHash } from '@prayertools/shared/tokens'
import { ptMarketingHost } from '@prayertools/shared/marketing-host'
import type { EmailVersions, MarketingHost, MarketingMail } from '../lib/types'

export interface TestEnv {
  admin: Db
  app: Db
  orgs: string[]
  emails: string[]
  users: string[]
}

export function testEnv(): TestEnv {
  return {
    admin: createDb(process.env.DATABASE_URL!, { max: 5 }),
    app: createDb(process.env.APP_DATABASE_URL!, { max: 10 }),
    orgs: [],
    emails: [],
    users: []
  }
}

export function uid(): string {
  return randomBytes(4).toString('hex')
}

export function testEmail(env: TestEnv, label = 'p'): string {
  const e = `${label}-${uid()}@test.example`
  env.emails.push(e)
  return e
}

export function captureHost(overrides: Partial<MarketingHost> = {}): MarketingHost & { mails: MarketingMail[] } {
  const mails: MarketingMail[] = []
  return {
    ...(ptMarketingHost satisfies MarketingHost),
    send: async (m: MarketingMail) => {
      mails.push(m)
      return { id: `msg-${mails.length}` }
    },
    ...overrides,
    mails
  }
}

export async function createUser(env: TestEnv): Promise<string> {
  const row = await env.admin.insertInto('users').values({ email: `u-${uid()}@test.example`, display_name: 'Test Champion', created: new Date(), updated: new Date() }).returning('id').executeTakeFirstOrThrow()
  env.users.push(row.id)
  return row.id
}

export async function createSite(env: TestEnv, name?: string): Promise<{ orgId: string, slug: string, campaignId: string }> {
  await ensureSystemUser(env.admin)
  const slug = `m-${uid()}`
  const org = await env.admin.insertInto('orgs').values({ slug, name: name ?? `Site ${slug}`, created_at: new Date(), updated_at: new Date() }).returning('id').executeTakeFirstOrThrow()
  env.orgs.push(org.id)
  const campaignId = await withOrg(env.app, org.id, async (tx) => {
    await tx.insertInto('pt_site').values({
      org_id: org.id,
      status: 'published',
      languages: sql`'{en,fr}'::text[]`,
      default_language: 'en',
      timezone: 'UTC',
      email_identity: jsonb({ reply_to: 'champion@test.example' })
    }).execute()
    const c = await tx.insertInto('pt_campaign').values({
      slug: 'c1',
      name: `Lent ${slug}`,
      start_mode: 'date',
      start_date: '2026-01-01',
      end_mode: 'none',
      end_date: null,
      goal: 'people',
      cadence: 'daily',
      timezone: 'UTC',
      cta: jsonb({}),
      published_at: new Date()
    }).returning('id').executeTakeFirstOrThrow()
    return c.id
  })
  return { orgId: org.id, slug, campaignId }
}

export interface PersonOpts {
  email?: string
  name?: string
  consent?: boolean
  verified?: boolean
  language?: string
  joinedAt?: Date
  commitment?: boolean
}

export async function addPerson(env: TestEnv, site: { orgId: string, campaignId: string }, o: PersonOpts = {}): Promise<{ email: string, channelId: string, contactId: string }> {
  const email = o.email ?? testEmail(env)
  if (!env.emails.includes(email)) env.emails.push(email)
  return await withOrg(env.app, site.orgId, async (tx) => {
    const campaign = await tx.selectFrom('pt_campaign').selectAll().where('id', '=', site.campaignId).executeTakeFirstOrThrow()
    const res = await createWebSignup(tx, {
      campaign,
      email,
      name: o.name ?? 'Mary Test',
      language: o.language ?? 'en',
      timezone: 'UTC',
      commitments: [],
      consents: { siteUpdates: o.consent ?? true },
      preVerified: o.verified ?? true,
      capture: { surface: 'test', source: 'test' }
    })
    if (o.joinedAt) await tx.updateTable('pt_subscription').set({ created_at: o.joinedAt }).where('id', '=', res.subscription.id).execute()
    if (o.commitment ?? true) {
      await tx.insertInto('pt_commitment').values({
        subscription_id: res.subscription.id,
        campaign_id: site.campaignId,
        kind: 'recurring',
        frequency: 'daily',
        time: '07:00',
        timezone: 'UTC',
        starts_on: '2026-01-01'
      }).execute()
    }
    return { email, channelId: res.channelId, contactId: res.contactId }
  })
}

export function versions(subject = 'Hello {first_name}', body = 'News from {site_name}: {campaign_name} at {site_link}'): EmailVersions {
  return {
    en: { subject, preheader: 'A short note', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }] } },
    fr: { subject: 'Bonjour {first_name}', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nouvelles de {site_name}' }] }] } }
  }
}

export async function createEmail(env: TestEnv, orgId: string, o: { audiences?: string[], status?: 'draft' | 'scheduled', scheduledAt?: Date, parentId?: string | null } = {}): Promise<string> {
  return await withOrg(env.app, orgId, async (tx) => {
    const row = await sql<{ id: string }>`
      INSERT INTO marketing_email (versions, source_language, audiences, status, scheduled_at, parent_id)
      VALUES (${JSON.stringify(versions())}::text::jsonb, 'en', ${`{${(o.audiences ?? ['current_campaign']).join(',')}}`}::text[], ${o.status ?? 'scheduled'}, ${o.scheduledAt ?? new Date(Date.now() - 1000)}, ${o.parentId ?? null})
      RETURNING id
    `.execute(tx)
    return row.rows[0]!.id
  })
}

export async function deliveries(env: TestEnv, orgId: string, emailId: string) {
  return await withOrg(env.app, orgId, tx => sql<{ status: string, skip_reason: string | null, address: string | null, channel_id: string, attempts: number, error: string | null }>`
    SELECT status, skip_reason, address, channel_id, attempts, error FROM marketing_delivery WHERE email_id = ${emailId}
  `.execute(tx).then(r => r.rows))
}

export async function emailRow(env: TestEnv, orgId: string, emailId: string) {
  return await withOrg(env.app, orgId, tx => sql<{ status: string, recipients: number, sent: number, skipped: number, failed: number, unsubscribes: number, paused_reason: string | null, failed_reason: string | null }>`
    SELECT status, recipients, sent, skipped, failed, unsubscribes, paused_reason, failed_reason FROM marketing_email WHERE id = ${emailId}
  `.execute(tx).then(r => r.rows[0]!))
}

export async function consentOf(env: TestEnv, orgId: string, channelId: string, purpose = 'site_updates') {
  return await withOrg(env.app, orgId, async (tx) => {
    const state = await tx.selectFrom('crm_channel_consents').select('status').where('channel_id', '=', channelId).where('purpose', '=', purpose).executeTakeFirst()
    const events = await tx.selectFrom('crm_consent_events').select(['event', 'source', 'meta']).where('channel_id', '=', channelId).where('purpose', '=', purpose).orderBy('occurred_at').execute()
    return { status: state?.status ?? null, events }
  })
}

export async function cleanup(env: TestEnv): Promise<void> {
  if (env.orgs.length) await env.admin.deleteFrom('orgs').where('id', 'in', env.orgs).execute()
  if (env.emails.length) {
    await env.admin.deleteFrom('pt_intercessor').where(eb => eb.fn('lower', ['email']), 'in', env.emails.map(e => e.toLowerCase())).execute()
    await env.admin.deleteFrom('pt_suppression').where('address_hash', 'in', env.emails.map(e => emailHash(e))).execute()
  }
  if (env.users.length) await env.admin.deleteFrom('users').where('id', 'in', env.users).execute()
  env.orgs = []
  env.emails = []
  env.users = []
}

export async function closeEnv(env: TestEnv): Promise<void> {
  await cleanup(env)
  await env.admin.destroy()
  await env.app.destroy()
}
