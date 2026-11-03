// A relaunched campaign points at the campaign it was relaunched from, so the
// runs of one campaign form a series (see campaignSeries).
import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE pt_campaign ADD COLUMN relaunch_of uuid REFERENCES pt_campaign(id) ON DELETE SET NULL`.execute(db)
  await sql`CREATE INDEX pt_campaign_relaunch_of_idx ON pt_campaign (relaunch_of) WHERE relaunch_of IS NOT NULL`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE pt_campaign DROP COLUMN relaunch_of`.execute(db)
}
