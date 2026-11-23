// The person behind a web prayer session, so "praying now" counts people
// rather than open pages: a per-site HMAC of the browser's visitor id that
// rotates daily, so a browser's sessions can't be linked across days.
import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE pt_prayer_session ADD COLUMN visitor text`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE pt_prayer_session DROP COLUMN visitor`.execute(db)
}
