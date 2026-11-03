// The landing page's hero shows its own subtitle; the description is for
// search, link previews and the directory. Campaigns and saved templates keep
// the text their hero already showed.
import { type Kysely, sql } from 'kysely'

const TABLES = ['pt_campaign', 'pt_personal_template']

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const table of TABLES) {
    await sql`
      UPDATE ${sql.table(table)}
      SET landing = jsonb_set(coalesce(landing, '{}'::jsonb), '{subtitle}', description)
      WHERE jsonb_typeof(description) = 'object' AND NOT coalesce(landing, '{}'::jsonb) ? 'subtitle'
    `.execute(db)
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of TABLES) {
    await sql`UPDATE ${sql.table(table)} SET landing = landing - 'subtitle' WHERE landing ? 'subtitle'`.execute(db)
  }
}
