// Personal library items can be shared with named people, as viewers or
// editors, through core's share tables: libraries, images and blocks. Only an
// item's owner shares it, inserts it or deletes it; editors change it.
// Libraries stay global and are filtered in code; images and blocks keep row
// security on `app.current_user`.
import { type Kysely, sql } from 'kysely'
import { createShareTable, dropShareTable, sharedWithMe, CURRENT_USER_SQL } from '@nuxtinator/core/share-tables'

const PERSONAL = ['pt_personal_asset', 'pt_personal_block']
const SHARED = ['pt_library', ...PERSONAL]

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const table of SHARED) {
    await createShareTable(db, { table: `${table}_shares`, resourceTable: table, ownerColumn: 'owner_user_id' })
  }
  for (const table of PERSONAL) {
    await sql`DROP POLICY IF EXISTS user_isolation ON ${sql.ref(table)}`.execute(db)
    await createSharedItemPolicies(db, table)
  }
}

// The owner reads and writes; anyone the item is shared with reads it, and
// editors change it. An update can't move the item to another owner: the
// owner function reads the row as it was before the statement.
async function createSharedItemPolicies(db: Kysely<unknown>, table: string): Promise<void> {
  const shares = { table: `${table}_shares` }
  const owner = `owner_user_id = ${CURRENT_USER_SQL}`
  await sql.raw(`CREATE POLICY user_read ON ${table} FOR SELECT USING (${owner} OR ${sharedWithMe(shares, `${table}.id`)})`).execute(db)
  await sql.raw(`CREATE POLICY user_insert ON ${table} FOR INSERT WITH CHECK (${owner})`).execute(db)
  await sql.raw(`CREATE POLICY user_update ON ${table} FOR UPDATE
    USING (${owner} OR ${sharedWithMe(shares, `${table}.id`, { role: 'editor' })})
    WITH CHECK (owner_user_id = ${table}_shares_resource_owner(id))`).execute(db)
  await sql.raw(`CREATE POLICY user_delete ON ${table} FOR DELETE USING (${owner})`).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of SHARED) await dropShareTable(db, { table: `${table}_shares` })
  for (const table of PERSONAL) {
    for (const p of ['user_read', 'user_insert', 'user_update', 'user_delete']) {
      await sql`DROP POLICY IF EXISTS ${sql.ref(p)} ON ${sql.ref(table)}`.execute(db)
    }
    await sql`
      CREATE POLICY user_isolation ON ${sql.ref(table)} FOR ALL
        USING       (owner_user_id = nullif(current_setting('app.current_user', true), '')::uuid)
        WITH CHECK  (owner_user_id = nullif(current_setting('app.current_user', true), '')::uuid)
    `.execute(db)
  }
}
