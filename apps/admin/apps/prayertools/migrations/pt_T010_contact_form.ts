// The contact form's extra questions and notification recipients.
import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE pt_site ADD COLUMN contact_form jsonb NOT NULL DEFAULT '{}'::jsonb`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE pt_site DROP COLUMN contact_form`.execute(db)
}
