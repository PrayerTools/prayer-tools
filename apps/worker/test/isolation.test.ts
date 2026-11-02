// Site isolation as the admin app and the worker see it: inside one site's org
// transaction on the RLS role, no prayer.tools or marketing row of another site
// is visible, and every policy on those tables is the org-only, personal or
// public person shape.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import * as path from 'node:path'
import { sql } from 'kysely'
import { withOrg } from '@prayertools/shared/db/scope'
import { jsonb } from '@prayertools/shared/db/json'
import { cleanup, closeEnv, createCampaign, createSite, createSubscriber, testEnv, type TestEnv } from './helpers'

// Tables with an org_id that are read outside any org, always filtered by
// org_id in code.
const GLOBAL_ORG_TABLES = new Set([
  'pt_site_domain', // resolves a request's host to its site before the org is known
  'pt_legacy_key', // resolves old links to their site before the org is known
  'pt_directory_entry', // the public directory, reviewed by operators
  'pt_site_report', // reports from the public, reviewed by operators
  'pt_job', // the worker's queue
  'marketing_parent_recipient' // one-email-per-person ledger of a multi-site send, used only by the worker
])

const ACTIVE_ORG = `(org_id = (NULLIF(current_setting('app.current_org'::text, true), ''::text))::uuid)`
const CURRENT_USER = `(owner_user_id = (NULLIF(current_setting('app.current_user'::text, true), ''::text))::uuid)`
// The public server's person scope (`withPerson`) reads a person's own rows across sites.
const PERSON_READ_TABLES = ['pt_commitment', 'pt_person_total', 'pt_subscription']

// A personal item shared through its `<table>_shares` table: the owner reads
// and writes, people it is shared with read it, editors update it, and no
// update moves it to another owner.
function sharedItemPolicyOk(p: { tablename: string, policyname: string, qual: string | null, with_check: string | null }): boolean {
  const ownerOrShared = !!p.qual?.startsWith(`(${CURRENT_USER} OR (EXISTS`) && p.qual.includes(`FROM ${p.tablename}_shares s`)
  switch (p.policyname) {
    case 'user_read': return ownerOrShared && p.with_check === null
    case 'user_insert': return p.qual === null && p.with_check === CURRENT_USER
    case 'user_update': return ownerOrShared && p.qual!.includes(`'editor'`) && p.with_check === `(owner_user_id = ${p.tablename}_shares_resource_owner(id))`
    case 'user_delete': return p.qual === CURRENT_USER && p.with_check === null
    default: return false
  }
}

// Core's share-table policies, which go through the table's owner function.
function shareTablePolicyOk(p: { tablename: string, qual: string | null, with_check: string | null }): boolean {
  const caller = `(NULLIF(current_setting('app.current_user'::text, true), ''::text))::uuid`
  return `${p.qual ?? ''} ${p.with_check ?? ''}`.includes(`${p.tablename}_resource_owner(resource_id) = ${caller}`)
}

let env: TestEnv
beforeAll(() => { env = testEnv() })
afterEach(async () => { await cleanup(env) })
afterAll(async () => { await closeEnv(env) })

async function siteTables(): Promise<{ name: string, rls: boolean }[]> {
  const rows = await sql<{ name: string, rls: boolean }>`
    select c.relname as name, c.relrowsecurity as rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped
    where c.relkind in ('r', 'p') and not c.relispartition
      and (c.relname like 'pt\\_%' or c.relname like 'marketing\\_%')
    order by 1
  `.execute(env.admin)
  return rows.rows
}

async function seedSite(): Promise<string> {
  const { orgId } = await createSite(env)
  const campaign = await createCampaign(env, orgId)
  await createSubscriber(env, orgId, campaign)
  await withOrg(env.admin, orgId, tx => sql`
    INSERT INTO marketing_email (versions, source_language, audiences, status)
    VALUES (${jsonb({ en: { subject: 'x', content: { type: 'doc' } } })}, 'en', '{current_campaign}', 'draft')
  `.execute(tx))
  return orgId
}

describe('site isolation', () => {
  it('shows a site transaction only that site\'s rows in every prayer.tools and marketing table', async () => {
    const a = await seedSite()
    const b = await seedSite()
    const tables = await siteTables()
    expect(tables.filter(t => !t.rls).map(t => t.name).sort()).toEqual([...GLOBAL_ORG_TABLES].sort())

    const checked: string[] = []
    for (const { name } of tables.filter(t => t.rls)) {
      const theirs = await sql<{ n: number }>`select count(*)::int as n from ${sql.table(name)} where org_id = ${b}`.execute(env.admin)
      const seen = await withOrg(env.app, a, tx => sql<{ org_id: string }>`select distinct org_id from ${sql.table(name)}`.execute(tx))
      expect(seen.rows.map(r => r.org_id).filter(id => id !== a), name).toEqual([])
      if (theirs.rows[0]!.n > 0) checked.push(name)
    }
    // The other site really has rows in the main tables, so the check above means something.
    expect(checked).toEqual(expect.arrayContaining(['pt_site', 'pt_campaign', 'pt_subscription', 'marketing_email']))

    const outside = await env.app.selectFrom('pt_site').select('org_id').execute()
    expect(outside).toEqual([])
  })

  it('has only org, personal and public-person policies on prayer.tools and marketing tables', async () => {
    const policies = await sql<{ tablename: string, policyname: string, cmd: string, qual: string | null, with_check: string | null }>`
      select tablename, policyname, cmd, qual, with_check from pg_policies
      where schemaname = 'public' and (tablename like 'pt\\_%' or tablename like 'marketing\\_%')
    `.execute(env.admin)
    const orgTables = new Set((await siteTables()).map(t => t.name))
    const odd = policies.rows.filter((p) => {
      if (p.policyname === 'tenant_isolation') return !(p.qual === ACTIVE_ORG && (p.with_check === null || p.with_check === ACTIVE_ORG))
      if (p.policyname === 'user_isolation') return orgTables.has(p.tablename) || p.qual !== CURRENT_USER || p.with_check !== CURRENT_USER
      if (p.policyname === 'person_read') return !PERSON_READ_TABLES.includes(p.tablename) || p.cmd !== 'SELECT' || !p.qual?.includes('current_intercessor_id()')
      if (p.policyname.startsWith('user_')) return orgTables.has(p.tablename) || !sharedItemPolicyOk(p)
      if (p.tablename.endsWith('_shares') && p.policyname.startsWith(`${p.tablename}_`)) return orgTables.has(p.tablename) || !shareTablePolicyOk(p)
      return true
    })
    expect(odd).toEqual([])
    expect(policies.rows.filter(p => p.policyname === 'person_read').map(p => p.tablename).sort()).toEqual(PERSON_READ_TABLES)
  })

  it('leaves the person scope to the public server: the admin app and worker never set it', () => {
    const root = path.resolve(import.meta.dirname, '../..')
    const skip = new Set(['node_modules', '.nuxt', '.output', '_layers', 'migrations', 'test'])
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (skip.has(entry)) continue
        const full = path.join(dir, entry)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.(ts|vue|mjs)$/.test(entry) && /current_intercessor|withPerson\b/.test(readFileSync(full, 'utf8'))) offenders.push(path.relative(root, full))
      }
    }
    walk(path.join(root, 'admin'))
    walk(path.join(root, 'worker'))
    expect(offenders).toEqual([])
  })
})
