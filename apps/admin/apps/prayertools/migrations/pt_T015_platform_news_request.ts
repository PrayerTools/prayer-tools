// "News from Prayer.Tools" asked for at signup is granted once the address is
// verified; until then the subscription records the request.
import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE pt_subscription ADD COLUMN platform_news_requested_at timestamptz`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE pt_subscription DROP COLUMN platform_news_requested_at`.execute(db)
}
