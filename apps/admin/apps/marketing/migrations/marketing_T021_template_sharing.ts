// Templates can be shared with named people, as viewers or editors, through
// core's share tables. The owner reads and writes; anyone a template is
// shared with reads it, and editors change it. Only the owner shares,
// inserts or deletes. An update can't move a template to another owner: the
// owner function reads the row as it was before the statement.
import { type Kysely, sql } from 'kysely'
import { createShareTable, dropShareTable, sharedWithMe, CURRENT_USER_SQL } from '@nuxtinator/core/share-tables'

const SPEC = { table: 'marketing_template_shares', resourceTable: 'marketing_template', ownerColumn: 'owner_user_id' }

export async function up(db: Kysely<unknown>): Promise<void> {
  await createShareTable(db, SPEC)
  const owner = `owner_user_id = ${CURRENT_USER_SQL}`
  await sql`DROP POLICY IF EXISTS user_isolation ON marketing_template`.execute(db)
  await sql.raw(`CREATE POLICY user_read ON marketing_template FOR SELECT USING (${owner} OR ${sharedWithMe(SPEC, 'marketing_template.id')})`).execute(db)
  await sql.raw(`CREATE POLICY user_insert ON marketing_template FOR INSERT WITH CHECK (${owner})`).execute(db)
  await sql.raw(`CREATE POLICY user_update ON marketing_template FOR UPDATE
    USING (${owner} OR ${sharedWithMe(SPEC, 'marketing_template.id', { role: 'editor' })})
    WITH CHECK (owner_user_id = marketing_template_shares_resource_owner(id))`).execute(db)
  await sql.raw(`CREATE POLICY user_delete ON marketing_template FOR DELETE USING (${owner})`).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const p of ['user_read', 'user_insert', 'user_update', 'user_delete']) {
    await sql`DROP POLICY IF EXISTS ${sql.ref(p)} ON marketing_template`.execute(db)
  }
  await dropShareTable(db, SPEC)
  await sql`
    CREATE POLICY user_isolation ON marketing_template FOR ALL
      USING       (owner_user_id = nullif(current_setting('app.current_user', true), '')::uuid)
      WITH CHECK  (owner_user_id = nullif(current_setting('app.current_user', true), '')::uuid)
  `.execute(db)
}
