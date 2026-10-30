// A personal-start commitment records when the person finished the campaign,
// so its thank-you is sent once, apart from the rest of their subscription.
// Commitments already thanked count as finished. Campaigns are inserted with
// an explicit `published_at`; a missing one no longer publishes.
import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE pt_commitment ADD COLUMN finished_at timestamptz`.execute(db)
  await sql`
    UPDATE pt_commitment c
    SET finished_at = coalesce(s.completed_at, now())
    FROM pt_campaign k, pt_subscription s
    WHERE k.id = c.campaign_id AND s.id = c.subscription_id AND k.start_mode = 'join'
      AND (s.status = 'completed' OR EXISTS (
        SELECT 1 FROM pt_email_log l
        WHERE l.subscription_id = c.subscription_id AND l.campaign_id = c.campaign_id AND l.kind = 'thank_you'
      ))
  `.execute(db)
  await sql`ALTER TABLE pt_campaign ALTER COLUMN published_at DROP DEFAULT`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE pt_campaign ALTER COLUMN published_at SET DEFAULT now()`.execute(db)
  await sql`ALTER TABLE pt_commitment DROP COLUMN finished_at`.execute(db)
}
