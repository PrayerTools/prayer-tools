// Libraries that come out again each year share a series (e.g. "Ramadan") and
// name their edition (e.g. "2026"); the catalog shows a series' newest
// edition and keeps the earlier ones a click away.
import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE pt_library ADD COLUMN series text, ADD COLUMN edition text`.execute(db)
  await sql`
    UPDATE pt_library SET series = 'Ramadan', edition = substring(title from '(\\d{4})$')
    WHERE owner_user_id IS NULL AND title ~ '^Ramadan \\d{4}$'
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE pt_library DROP COLUMN series, DROP COLUMN edition`.execute(db)
}
