// Personal library items shared with named people, as the RLS role sees them
// in a personal-app transaction (`app.current_user`): a viewer reads, an
// editor also updates, anyone else sees nothing, and only the owner shares.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'kysely'
import { jsonb } from '@prayertools/shared/db/json'
import type { Tx } from '@prayertools/shared/db/scope'
import { cleanup, closeEnv, testEnv, uid, type TestEnv } from './helpers'

let env: TestEnv
beforeAll(() => { env = testEnv() })
afterEach(async () => { await cleanup(env) })
afterAll(async () => { await closeEnv(env) })

async function as<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return await env.app.transaction().execute(async (tx) => {
    await sql`select set_config('app.current_user', ${userId}, true)`.execute(tx)
    return await fn(tx)
  })
}

async function user(name: string): Promise<string> {
  const row = await env.admin.insertInto('users').values({ email: `${name}-${uid()}@test.example`, display_name: name, created: new Date(), updated: new Date() }).returning('id').executeTakeFirstOrThrow()
  env.users.push(row.id)
  return row.id
}

const doc = (text: string) => jsonb({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

// One shareable item type: how to make an item as its owner, and the column an update changes.
const ITEMS = [
  {
    table: 'pt_personal_block',
    create: (owner: string) => as(owner, tx => sql<{ id: string }>`INSERT INTO pt_personal_block (owner_user_id, name, content) VALUES (${owner}, 'Block', ${doc('Pray')}) RETURNING id`.execute(tx)),
    column: 'name'
  },
  {
    table: 'pt_personal_asset',
    create: (owner: string) => as(owner, tx => sql<{ id: string }>`INSERT INTO pt_personal_asset (owner_user_id, storage_key, url, content_type) VALUES (${owner}, 'k', 'https://x.test/a.webp', 'image/webp') RETURNING id`.execute(tx)),
    column: 'credit'
  },
  {
    table: 'marketing_template',
    create: (owner: string) => as(owner, tx => sql<{ id: string }>`INSERT INTO marketing_template (owner_user_id, name, versions, source_language) VALUES (${owner}, 'Template', ${jsonb({ en: { subject: 'Hi', content: { type: 'doc' } } })}, 'en') RETURNING id`.execute(tx)),
    column: 'name'
  }
]

async function share(table: string, by: string, resourceId: string, to: string, role: 'viewer' | 'editor') {
  await as(by, tx => sql`INSERT INTO ${sql.table(`${table}_shares`)} (resource_id, grantee_user_id, role, granted_by) VALUES (${resourceId}, ${to}, ${role}, ${by})`.execute(tx))
}

async function seen(table: string, userId: string, id: string): Promise<number> {
  return (await as(userId, tx => sql`SELECT id FROM ${sql.table(table)} WHERE id = ${id}`.execute(tx))).rows.length
}

async function rename(table: string, column: string, userId: string, id: string, value: string): Promise<number> {
  const res = await as(userId, tx => sql`UPDATE ${sql.table(table)} SET ${sql.ref(column)} = ${value} WHERE id = ${id}`.execute(tx))
  return Number(res.numAffectedRows ?? 0)
}

describe.each(ITEMS)('sharing $table', ({ table, create, column }) => {
  it('lets a viewer read but not change it, and hides it from everyone else', async () => {
    const [owner, viewer, stranger] = [await user('Owner'), await user('Viewer'), await user('Stranger')]
    const id = (await create(owner)).rows[0]!.id
    await share(table, owner, id, viewer, 'viewer')

    expect(await seen(table, viewer, id)).toBe(1)
    expect(await seen(table, stranger, id)).toBe(0)
    expect(await rename(table, column, viewer, id, 'by viewer')).toBe(0)
    expect(await rename(table, column, stranger, id, 'by stranger')).toBe(0)
    const del = await as(viewer, tx => sql`DELETE FROM ${sql.table(table)} WHERE id = ${id}`.execute(tx))
    expect(Number(del.numAffectedRows)).toBe(0)
    expect(await seen(table, owner, id)).toBe(1)
  })

  it('lets an editor change it, but not delete it or give it to someone else', async () => {
    const [owner, editor] = [await user('Owner'), await user('Editor')]
    const id = (await create(owner)).rows[0]!.id
    await share(table, owner, id, editor, 'editor')

    expect(await rename(table, column, editor, id, 'by editor')).toBe(1)
    const row = await env.admin.selectFrom(table as 'pt_personal_block').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
    expect((row as Record<string, unknown>)[column]).toBe('by editor')
    await expect(as(editor, tx => sql`UPDATE ${sql.table(table)} SET owner_user_id = ${editor} WHERE id = ${id}`.execute(tx))).rejects.toThrow(/row-level security/)
    const del = await as(editor, tx => sql`DELETE FROM ${sql.table(table)} WHERE id = ${id}`.execute(tx))
    expect(Number(del.numAffectedRows)).toBe(0)
  })

  it('lets only the owner share it', async () => {
    const [owner, editor, other] = [await user('Owner'), await user('Editor'), await user('Other')]
    const id = (await create(owner)).rows[0]!.id
    await share(table, owner, id, editor, 'editor')

    await expect(share(table, editor, id, other, 'viewer')).rejects.toThrow(/row-level security/)
    const changed = await as(editor, tx => sql`UPDATE ${sql.table(`${table}_shares`)} SET role = 'editor' WHERE resource_id = ${id}`.execute(tx))
    expect(Number(changed.numAffectedRows)).toBe(0)
    expect(await seen(table, other, id)).toBe(0)
    await share(table, owner, id, other, 'viewer')
    expect(await seen(table, other, id)).toBe(1)
  })
})

describe('sharing libraries', () => {
  it('records who a library is shared with; only the owner shares it', async () => {
    const [owner, editor, other] = [await user('Owner'), await user('Editor'), await user('Other')]
    const lib = await env.admin.insertInto('pt_library').values({ owner_user_id: owner, title: `Lib ${uid()}`, cadence: 'daily', source_language: 'en', license: 'own' }).returning('id').executeTakeFirstOrThrow()
    await share('pt_library', owner, lib.id, editor, 'editor')

    // Site transactions don't set the personal-app user; the owner function answers there.
    const member = async (userId: string) => (await sql<{ m: boolean }>`select pt_library_shares_has_member(${lib.id}::uuid, ${userId}::uuid) as m`.execute(env.app)).rows[0]!.m
    expect(await member(editor)).toBe(true)
    expect(await member(other)).toBe(false)
    const roles = await as(editor, tx => sql<{ role: string }>`SELECT role FROM pt_library_shares WHERE resource_id = ${lib.id} AND grantee_user_id = ${editor}`.execute(tx))
    expect(roles.rows.map(r => r.role)).toEqual(['editor'])
    expect((await as(other, tx => sql`SELECT id FROM pt_library_shares WHERE resource_id = ${lib.id}`.execute(tx))).rows).toEqual([])
    await expect(share('pt_library', editor, lib.id, other, 'viewer')).rejects.toThrow(/row-level security/)
    await env.admin.deleteFrom('pt_library').where('id', '=', lib.id).execute()
  })
})
