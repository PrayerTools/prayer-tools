// A champion's own campaign templates, kept in their personal library and
// shared like its other items: a campaign's setup answers, landing page,
// end-of-campaign message, call to action and the libraries it uses. The
// owner reads and writes; anyone a template is shared with reads it, and
// editors change it. Only the owner shares, inserts or deletes. An update
// can't move a template to another owner: the owner function reads the row as
// it was before the statement.
import { type Kysely, sql } from 'kysely'
import { createShareTable, dropShareTable, sharedWithMe, CURRENT_USER_SQL } from '@nuxtinator/core/share-tables'

const SPEC = { table: 'pt_personal_template_shares', resourceTable: 'pt_personal_template', ownerColumn: 'owner_user_id' }

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE pt_personal_template (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name text NOT NULL,
      template_key text,
      setup jsonb NOT NULL DEFAULT '{}'::jsonb,
      landing jsonb NOT NULL DEFAULT '{}'::jsonb,
      branding jsonb NOT NULL DEFAULT '{}'::jsonb,
      description jsonb,
      end_message jsonb,
      cta jsonb NOT NULL DEFAULT '{}'::jsonb,
      library_ids uuid[] NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)
  await sql`CREATE INDEX pt_personal_template_owner_idx ON pt_personal_template (owner_user_id, updated_at DESC)`.execute(db)
  await createShareTable(db, SPEC)

  const owner = `owner_user_id = ${CURRENT_USER_SQL}`
  await sql`ALTER TABLE pt_personal_template ENABLE ROW LEVEL SECURITY`.execute(db)
  await sql.raw(`CREATE POLICY user_read ON pt_personal_template FOR SELECT USING (${owner} OR ${sharedWithMe(SPEC, 'pt_personal_template.id')})`).execute(db)
  await sql.raw(`CREATE POLICY user_insert ON pt_personal_template FOR INSERT WITH CHECK (${owner})`).execute(db)
  await sql.raw(`CREATE POLICY user_update ON pt_personal_template FOR UPDATE
    USING (${owner} OR ${sharedWithMe(SPEC, 'pt_personal_template.id', { role: 'editor' })})
    WITH CHECK (owner_user_id = pt_personal_template_shares_resource_owner(id))`).execute(db)
  await sql.raw(`CREATE POLICY user_delete ON pt_personal_template FOR DELETE USING (${owner})`).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await dropShareTable(db, SPEC)
  await sql`DROP TABLE IF EXISTS pt_personal_template`.execute(db)
}
