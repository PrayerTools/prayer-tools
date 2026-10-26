// Prayer times chosen on the public signup form for an address already
// confirmed on the site. They wait here until the address's owner confirms
// them from the email link; expired requests are deleted by the worker.
import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE pt_signup_request (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      subscription_id uuid NOT NULL REFERENCES pt_subscription(id) ON DELETE CASCADE,
      campaign_id uuid NOT NULL REFERENCES pt_campaign(id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      request jsonb NOT NULL,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)
  await sql`CREATE INDEX pt_signup_request_subscription_idx ON pt_signup_request (subscription_id, campaign_id)`.execute(db)
  await sql`CREATE INDEX pt_signup_request_expires_idx ON pt_signup_request (expires_at)`.execute(db)
  await sql`ALTER TABLE pt_signup_request ENABLE ROW LEVEL SECURITY`.execute(db)
  await sql`
    CREATE POLICY tenant_isolation ON pt_signup_request FOR ALL
      USING       (org_id = nullif(current_setting('app.current_org', true), '')::uuid)
      WITH CHECK  (org_id = nullif(current_setting('app.current_org', true), '')::uuid)
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS pt_signup_request`.execute(db)
}
