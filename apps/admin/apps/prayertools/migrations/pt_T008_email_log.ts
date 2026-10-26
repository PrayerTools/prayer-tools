// Site emails sent to a subscriber (reminders, check-ins, thank-yous,
// verification and manage links), listed in the person's activity on their
// contact record. `kind` is a code key; its label lives in the admin app.
import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE pt_email_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      subscription_id uuid NOT NULL REFERENCES pt_subscription(id) ON DELETE CASCADE,
      campaign_id uuid REFERENCES pt_campaign(id) ON DELETE SET NULL,
      kind text NOT NULL,
      subject text NOT NULL,
      day integer,
      sent_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)
  await sql`CREATE INDEX pt_email_log_subscription_idx ON pt_email_log (subscription_id, sent_at DESC)`.execute(db)
  await sql`CREATE INDEX pt_email_log_sent_idx ON pt_email_log (sent_at)`.execute(db)
  await sql`ALTER TABLE pt_email_log ENABLE ROW LEVEL SECURITY`.execute(db)
  await sql`
    CREATE POLICY tenant_isolation ON pt_email_log FOR ALL
      USING       (org_id = nullif(current_setting('app.current_org', true), '')::uuid)
      WITH CHECK  (org_id = nullif(current_setting('app.current_org', true), '')::uuid)
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS pt_email_log`.execute(db)
}
