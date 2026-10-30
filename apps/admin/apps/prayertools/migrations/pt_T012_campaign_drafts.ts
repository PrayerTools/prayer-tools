// A campaign stays a draft, off the public site, until it is published.
// Existing campaigns count as published when they were created.
import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE pt_campaign ADD COLUMN published_at timestamptz`.execute(db)
  await sql`UPDATE pt_campaign SET published_at = created_at`.execute(db)
  await sql`ALTER TABLE pt_campaign ALTER COLUMN published_at SET DEFAULT now()`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE pt_campaign DROP COLUMN published_at`.execute(db)
}
