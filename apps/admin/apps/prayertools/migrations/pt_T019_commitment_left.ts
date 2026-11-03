// When the person left the campaign, which ends the commitment apart from the
// campaign ending. The row stays, so a fixed campaign keeps counting them.
import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE pt_commitment ADD COLUMN left_at timestamptz`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE pt_commitment DROP COLUMN left_at`.execute(db)
}
