// Side campaigns run beside a site's main campaign at their own address, on
// fixed dates, with their own landing page. NULL kind is the main campaign.
import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE pt_campaign
      ADD COLUMN kind text CHECK (kind IN ('side')),
      ADD COLUMN landing jsonb,
      ADD COLUMN description jsonb,
      ADD CONSTRAINT pt_campaign_side_dated CHECK (kind IS NULL OR (start_mode = 'date' AND end_mode = 'date'))
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE pt_campaign
      DROP CONSTRAINT IF EXISTS pt_campaign_side_dated,
      DROP COLUMN IF EXISTS description,
      DROP COLUMN IF EXISTS landing,
      DROP COLUMN IF EXISTS kind
  `.execute(db)
}
