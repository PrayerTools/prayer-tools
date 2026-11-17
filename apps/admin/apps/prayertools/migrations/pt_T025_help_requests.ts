// "Ask Prayer.Tools for help": a site team member sends one inbox
// conversation to the platform operators, who answer it once. Operators read
// these across sites on the BYPASSRLS connection. A request goes with its
// conversation or site; the people on it are cleared when their account goes.
import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE pt_help_request (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      conversation_id uuid NOT NULL REFERENCES inbox_conversations(id) ON DELETE CASCADE,
      requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
      note text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      handled_at timestamptz,
      handled_by uuid REFERENCES users(id) ON DELETE SET NULL,
      reply text
    )
  `.execute(db)
  await sql`CREATE UNIQUE INDEX pt_help_request_open_idx ON pt_help_request (conversation_id) WHERE handled_at IS NULL`.execute(db)
  await sql`CREATE INDEX pt_help_request_created_idx ON pt_help_request (created_at DESC)`.execute(db)
  await sql`ALTER TABLE pt_help_request ENABLE ROW LEVEL SECURITY`.execute(db)
  await sql`
    CREATE POLICY tenant_isolation ON pt_help_request FOR ALL
      USING       (org_id = nullif(current_setting('app.current_org', true), '')::uuid)
      WITH CHECK  (org_id = nullif(current_setting('app.current_org', true), '')::uuid)
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS pt_help_request`.execute(db)
}
