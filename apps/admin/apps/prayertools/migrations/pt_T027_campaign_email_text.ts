// A campaign's own words in its welcome and reminder emails, kept with it and
// with the champion's saved templates. Empty adds nothing to the emails.
import { type Kysely, sql } from 'kysely'

const TABLES = ['pt_campaign', 'pt_personal_template']

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const table of TABLES) {
    await sql`ALTER TABLE ${sql.table(table)} ADD COLUMN email_text jsonb NOT NULL DEFAULT '{}'::jsonb`.execute(db)
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of TABLES) {
    await sql`ALTER TABLE ${sql.table(table)} DROP COLUMN email_text`.execute(db)
  }
}
