// Marketing tables. Named as a tenancy migration (`_T<NNN>_`) so it runs after
// the tenancy layer has created `orgs` and `current_org_id()`: per-site tables
// carry org_id + RLS from the start. Parents, their recipient fingerprints and
// templates belong to a user, outside org scoping.
import { type Kysely, sql } from 'kysely'

async function scopeToOrg(db: Kysely<unknown>, table: string): Promise<void> {
  await sql`ALTER TABLE ${sql.ref(table)} ENABLE ROW LEVEL SECURITY`.execute(db)
  await sql`
    CREATE POLICY tenant_isolation ON ${sql.ref(table)} FOR ALL
      USING       (org_id = nullif(current_setting('app.current_org', true), '')::uuid)
      WITH CHECK  (org_id = nullif(current_setting('app.current_org', true), '')::uuid)
  `.execute(db)
}

const STATUS_CHECK = sql`CHECK (status IN ('draft', 'scheduled', 'sending', 'paused', 'sent', 'cancelled'))`

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE marketing_parent (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      versions jsonb NOT NULL DEFAULT '{}'::jsonb,
      source_language text NOT NULL,
      org_ids uuid[] NOT NULL DEFAULT '{}',
      audiences text[] NOT NULL DEFAULT '{}',
      status text NOT NULL DEFAULT 'draft' ${STATUS_CHECK},
      scheduled_at timestamptz,
      resolved_at timestamptz,
      started_at timestamptz,
      finished_at timestamptz,
      people integer NOT NULL DEFAULT 0,
      recipients integer NOT NULL DEFAULT 0,
      sent integer NOT NULL DEFAULT 0,
      skipped integer NOT NULL DEFAULT 0,
      failed integer NOT NULL DEFAULT 0,
      unsubscribes integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)
  await sql`CREATE INDEX marketing_parent_owner_idx ON marketing_parent (owner_user_id, created_at DESC)`.execute(db)
  await sql`CREATE INDEX marketing_parent_due_idx ON marketing_parent (scheduled_at) WHERE status IN ('scheduled', 'sending', 'paused')`.execute(db)

  await sql`
    CREATE TABLE marketing_parent_recipient (
      parent_id uuid NOT NULL REFERENCES marketing_parent(id) ON DELETE CASCADE,
      fingerprint text NOT NULL,
      org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      joined_at timestamptz NOT NULL,
      PRIMARY KEY (parent_id, fingerprint)
    )
  `.execute(db)

  await sql`
    CREATE TABLE marketing_template (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name text NOT NULL,
      versions jsonb NOT NULL DEFAULT '{}'::jsonb,
      source_language text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)
  await sql`CREATE INDEX marketing_template_owner_idx ON marketing_template (owner_user_id, updated_at DESC)`.execute(db)

  await sql`
    CREATE TABLE marketing_email (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      parent_id uuid REFERENCES marketing_parent(id) ON DELETE SET NULL,
      versions jsonb NOT NULL DEFAULT '{}'::jsonb,
      source_language text NOT NULL,
      audiences text[] NOT NULL DEFAULT '{}',
      status text NOT NULL DEFAULT 'draft' ${STATUS_CHECK},
      scheduled_at timestamptz,
      started_at timestamptz,
      finished_at timestamptz,
      paused_reason text,
      recipients integer NOT NULL DEFAULT 0,
      sent integer NOT NULL DEFAULT 0,
      skipped integer NOT NULL DEFAULT 0,
      failed integer NOT NULL DEFAULT 0,
      unsubscribes integer NOT NULL DEFAULT 0,
      created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)
  await sql`CREATE INDEX marketing_email_org_idx ON marketing_email (org_id, created_at DESC)`.execute(db)
  await sql`CREATE INDEX marketing_email_due_idx ON marketing_email (scheduled_at) WHERE status IN ('scheduled', 'sending')`.execute(db)
  await sql`CREATE INDEX marketing_email_parent_idx ON marketing_email (parent_id) WHERE parent_id IS NOT NULL`.execute(db)
  await scopeToOrg(db, 'marketing_email')

  await sql`
    CREATE TABLE marketing_delivery (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      email_id uuid NOT NULL REFERENCES marketing_email(id) ON DELETE CASCADE,
      contact_id uuid REFERENCES records_entries(id) ON DELETE SET NULL,
      channel_id uuid REFERENCES crm_channels(id) ON DELETE SET NULL,
      address text,
      first_name text,
      language text NOT NULL,
      purpose text,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
      skip_reason text,
      error text,
      attempts integer NOT NULL DEFAULT 0,
      claimed_at timestamptz,
      provider_id text,
      sent_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (email_id, channel_id)
    )
  `.execute(db)
  await sql`CREATE INDEX marketing_delivery_pending_idx ON marketing_delivery (email_id, id) WHERE status = 'pending'`.execute(db)
  await sql`CREATE INDEX marketing_delivery_sent_idx ON marketing_delivery (org_id, sent_at) WHERE status = 'sent'`.execute(db)
  await sql`CREATE INDEX marketing_delivery_email_idx ON marketing_delivery (email_id, status)`.execute(db)
  await scopeToOrg(db, 'marketing_delivery')
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of ['marketing_delivery', 'marketing_email', 'marketing_template', 'marketing_parent_recipient', 'marketing_parent']) {
    await sql`DROP TABLE IF EXISTS ${sql.ref(t)} CASCADE`.execute(db)
  }
}
