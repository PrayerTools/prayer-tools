// "Notify me when this campaign runs again": a contact's request, confirmed
// from an emailed link, answered once by the worker when the next run in the
// campaign's series is published.
import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE pt_notify_request (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      contact_id uuid NOT NULL REFERENCES crm_records(id) ON DELETE CASCADE,
      campaign_id uuid NOT NULL REFERENCES pt_campaign(id) ON DELETE CASCADE,
      language text NOT NULL,
      token_hash text UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      confirmed_at timestamptz,
      notified_at timestamptz,
      notified_campaign_id uuid REFERENCES pt_campaign(id) ON DELETE SET NULL
    )
  `.execute(db)
  await sql`CREATE UNIQUE INDEX pt_notify_request_waiting_idx ON pt_notify_request (contact_id, campaign_id) WHERE notified_at IS NULL`.execute(db)
  await sql`CREATE INDEX pt_notify_request_due_idx ON pt_notify_request (org_id, campaign_id) WHERE confirmed_at IS NOT NULL AND notified_at IS NULL`.execute(db)
  await sql`ALTER TABLE pt_notify_request ENABLE ROW LEVEL SECURITY`.execute(db)
  await sql`
    CREATE POLICY tenant_isolation ON pt_notify_request FOR ALL
      USING       (org_id = nullif(current_setting('app.current_org', true), '')::uuid)
      WITH CHECK  (org_id = nullif(current_setting('app.current_org', true), '')::uuid)
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS pt_notify_request`.execute(db)
}
