// prayer.tools tables. Named as a tenancy migration (`_T<NNN>_`) so it runs
// after the tenancy layer has created `orgs` and `current_org_id()`: site
// tables carry org_id + RLS from the start.
import { type Kysely, sql } from 'kysely'

async function scopeToOrg(db: Kysely<unknown>, table: string): Promise<void> {
  await sql`ALTER TABLE ${sql.ref(table)} ENABLE ROW LEVEL SECURITY`.execute(db)
  await sql`
    CREATE POLICY tenant_isolation ON ${sql.ref(table)} FOR ALL
      USING       (org_id = nullif(current_setting('app.current_org', true), '')::uuid)
      WITH CHECK  (org_id = nullif(current_setting('app.current_org', true), '')::uuid)
  `.execute(db)
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE OR REPLACE FUNCTION current_intercessor_id() RETURNS uuid
      LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('app.current_intercessor', true), '')::uuid $$
  `.execute(db)

  // ── Global tables ────────────────────────────────────────────────────────

  await sql`
    CREATE TABLE pt_intercessor (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text,
      email_verified_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_active_at timestamptz
    )
  `.execute(db)
  await sql`CREATE UNIQUE INDEX pt_intercessor_email_uniq ON pt_intercessor (lower(email)) WHERE email IS NOT NULL`.execute(db)

  await sql`
    CREATE TABLE pt_intercessor_device (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      intercessor_id uuid NOT NULL REFERENCES pt_intercessor(id) ON DELETE CASCADE,
      credential_hash text NOT NULL UNIQUE,
      platform text,
      app_version text,
      push_id text,
      timezone text,
      language text,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)
  await sql`CREATE INDEX pt_intercessor_device_intercessor_idx ON pt_intercessor_device (intercessor_id)`.execute(db)

  await sql`
    CREATE TABLE pt_my_token (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      intercessor_id uuid NOT NULL REFERENCES pt_intercessor(id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)

  await sql`
    CREATE TABLE pt_my_session (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      intercessor_id uuid NOT NULL REFERENCES pt_intercessor(id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)

  await sql`
    CREATE TABLE pt_suppression (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      address_hash text NOT NULL UNIQUE,
      reason text NOT NULL CHECK (reason IN ('hard_bounce', 'complaint')),
      detail text,
      source text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)

  await sql`
    CREATE TABLE pt_job (
      id bigserial PRIMARY KEY,
      type text NOT NULL,
      org_id uuid REFERENCES orgs(id) ON DELETE CASCADE,
      reference_type text,
      reference_id text,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
      priority integer NOT NULL DEFAULT 0,
      scheduled_at timestamptz NOT NULL DEFAULT now(),
      attempts integer NOT NULL DEFAULT 0,
      max_attempts integer NOT NULL DEFAULT 3,
      last_attempt_at timestamptz,
      error_message text,
      result jsonb,
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)
  await sql`CREATE INDEX pt_job_due_idx ON pt_job (priority DESC, scheduled_at) WHERE status = 'pending'`.execute(db)
  await sql`CREATE INDEX pt_job_reference_idx ON pt_job (reference_type, reference_id)`.execute(db)
  await sql`
    CREATE UNIQUE INDEX pt_job_dedupe_uniq ON pt_job (type, reference_type, reference_id)
      WHERE reference_type IS NOT NULL AND status IN ('pending', 'processing')
  `.execute(db)

  await sql`
    CREATE TABLE pt_site_domain (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      hostname text NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'failing')),
      cf_hostname_id text,
      verification jsonb NOT NULL DEFAULT '{}'::jsonb,
      last_checked_at timestamptz,
      activated_at timestamptz,
      failing_since timestamptz,
      alerted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)
  await sql`CREATE UNIQUE INDEX pt_site_domain_hostname_uniq ON pt_site_domain (lower(hostname))`.execute(db)
  await sql`CREATE INDEX pt_site_domain_org_idx ON pt_site_domain (org_id)`.execute(db)

  await sql`
    CREATE TABLE pt_directory_entry (
      org_id uuid PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
      slug text NOT NULL,
      name text NOT NULL,
      description text,
      languages text[] NOT NULL DEFAULT '{}',
      image_url text,
      status text NOT NULL CHECK (status IN ('requested', 'listed', 'unlisted')),
      people_count integer NOT NULL DEFAULT 0,
      campaign_name text,
      campaign_starts_on date,
      requested_at timestamptz,
      reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)
  await sql`CREATE INDEX pt_directory_listed_idx ON pt_directory_entry (lower(name)) WHERE status = 'listed'`.execute(db)

  await sql`
    CREATE TABLE pt_site_report (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      reason text NOT NULL,
      details text,
      source text,
      created_at timestamptz NOT NULL DEFAULT now(),
      handled_at timestamptz,
      handled_by uuid REFERENCES users(id) ON DELETE SET NULL
    )
  `.execute(db)

  await sql`
    CREATE TABLE pt_library (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
      title text NOT NULL,
      description text,
      cadence text NOT NULL CHECK (cadence IN ('daily', 'weekly')),
      entry_count integer NOT NULL DEFAULT 0,
      languages text[] NOT NULL DEFAULT '{}',
      source_language text NOT NULL,
      topics text[] NOT NULL DEFAULT '{}',
      template_keys text[] NOT NULL DEFAULT '{}',
      license text NOT NULL,
      license_note text,
      credit text,
      visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'published')),
      share_status text CHECK (share_status IN ('requested', 'approved', 'rejected')),
      share_requested_at timestamptz,
      rights_confirmed boolean NOT NULL DEFAULT false,
      published_version integer NOT NULL DEFAULT 0,
      published_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)
  await sql`CREATE INDEX pt_library_owner_idx ON pt_library (owner_user_id)`.execute(db)

  await sql`
    CREATE TABLE pt_library_entry (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      library_id uuid NOT NULL REFERENCES pt_library(id) ON DELETE CASCADE,
      day integer NOT NULL CHECK (day >= 1),
      language text NOT NULL,
      draft jsonb NOT NULL,
      published jsonb,
      published_version integer,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (library_id, day, language)
    )
  `.execute(db)

  await sql`
    CREATE TABLE pt_personal_asset (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      storage_key text NOT NULL,
      url text NOT NULL,
      url_small text,
      content_type text NOT NULL,
      width integer,
      height integer,
      alt jsonb,
      credit text,
      focal_x real NOT NULL DEFAULT 0.5,
      focal_y real NOT NULL DEFAULT 0.5,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)
  await sql`CREATE INDEX pt_personal_asset_owner_idx ON pt_personal_asset (owner_user_id, created_at DESC)`.execute(db)

  await sql`
    CREATE TABLE pt_personal_block (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name text NOT NULL,
      content jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)

  await sql`
    CREATE TABLE pt_legacy_key (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('manage', 'fuel', 'ics')),
      key_hash text NOT NULL,
      subscription_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (kind, key_hash)
    )
  `.execute(db)

  // ── Site tables (org-scoped) ─────────────────────────────────────────────

  await sql`
    CREATE TABLE pt_site (
      org_id uuid PRIMARY KEY DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
      description jsonb,
      purpose text,
      place_name text,
      people_group text,
      latitude double precision,
      longitude double precision,
      languages text[] NOT NULL DEFAULT '{en}',
      default_language text NOT NULL DEFAULT 'en',
      timezone text NOT NULL DEFAULT 'UTC',
      branding jsonb NOT NULL DEFAULT '{}'::jsonb,
      email_identity jsonb NOT NULL DEFAULT '{}'::jsonb,
      landing jsonb NOT NULL DEFAULT '{}'::jsonb,
      share jsonb NOT NULL DEFAULT '{}'::jsonb,
      settings jsonb NOT NULL DEFAULT '{}'::jsonb,
      onboarding jsonb NOT NULL DEFAULT '{}'::jsonb,
      template_key text,
      preview_token_hash text,
      published_at timestamptz,
      archived_at timestamptz,
      anonymized_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)
  await scopeToOrg(db, 'pt_site')

  await sql`
    CREATE TABLE pt_campaign (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      slug text NOT NULL,
      name text NOT NULL,
      template_key text,
      start_mode text NOT NULL CHECK (start_mode IN ('date', 'join')),
      start_date date,
      end_mode text NOT NULL CHECK (end_mode IN ('date', 'none', 'days')),
      end_date date,
      length_days integer,
      goal text NOT NULL CHECK (goal IN ('people', 'prayer_time', 'coverage')),
      cadence text NOT NULL CHECK (cadence IN ('daily', 'weekly')),
      track_time boolean NOT NULL DEFAULT false,
      goal_target integer,
      timezone text NOT NULL,
      end_message jsonb,
      cta jsonb NOT NULL DEFAULT '{}'::jsonb,
      ended_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (org_id, slug),
      CHECK (start_mode = 'join' OR start_date IS NOT NULL),
      CHECK (end_mode <> 'date' OR end_date IS NOT NULL),
      CHECK (end_mode <> 'days' OR length_days IS NOT NULL)
    )
  `.execute(db)
  await sql`CREATE INDEX pt_campaign_org_start_idx ON pt_campaign (org_id, start_date)`.execute(db)
  await scopeToOrg(db, 'pt_campaign')

  await sql`
    CREATE TABLE pt_site_library (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      library_id uuid REFERENCES pt_library(id) ON DELETE SET NULL,
      title text NOT NULL,
      cadence text NOT NULL CHECK (cadence IN ('daily', 'weekly')),
      frozen_version integer,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)
  await sql`CREATE INDEX pt_site_library_org_idx ON pt_site_library (org_id)`.execute(db)
  await scopeToOrg(db, 'pt_site_library')

  await sql`
    CREATE TABLE pt_site_entry (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      site_library_id uuid NOT NULL REFERENCES pt_site_library(id) ON DELETE CASCADE,
      day integer NOT NULL CHECK (day >= 1),
      language text NOT NULL,
      content jsonb NOT NULL,
      edited boolean NOT NULL DEFAULT false,
      stale boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (site_library_id, day, language)
    )
  `.execute(db)
  await scopeToOrg(db, 'pt_site_entry')

  await sql`
    CREATE TABLE pt_campaign_library (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      campaign_id uuid NOT NULL REFERENCES pt_campaign(id) ON DELETE CASCADE,
      site_library_id uuid NOT NULL REFERENCES pt_site_library(id) ON DELETE CASCADE,
      position integer NOT NULL DEFAULT 0,
      UNIQUE (campaign_id, site_library_id)
    )
  `.execute(db)
  await scopeToOrg(db, 'pt_campaign_library')

  await sql`
    CREATE TABLE pt_subscription (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      contact_id uuid REFERENCES records_entries(id) ON DELETE SET NULL,
      intercessor_id uuid REFERENCES pt_intercessor(id) ON DELETE SET NULL,
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'completed', 'unsubscribed')),
      delivery text NOT NULL DEFAULT 'email' CHECK (delivery IN ('email', 'app')),
      language text NOT NULL,
      timezone text NOT NULL,
      verified_at timestamptz,
      verify_token_hash text,
      verify_expires_at timestamptz,
      manage_version integer NOT NULL DEFAULT 1,
      referral_code text NOT NULL,
      referred_by text,
      joined_from text,
      last_activity_at timestamptz,
      checkin_cycle_started_at timestamptz,
      unsubscribed_at timestamptz,
      inactive_at timestamptz,
      completed_at timestamptz,
      anonymized_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (org_id, referral_code)
    )
  `.execute(db)
  await sql`CREATE UNIQUE INDEX pt_subscription_contact_uniq ON pt_subscription (org_id, contact_id) WHERE contact_id IS NOT NULL`.execute(db)
  await sql`CREATE UNIQUE INDEX pt_subscription_app_uniq ON pt_subscription (org_id, intercessor_id) WHERE delivery = 'app'`.execute(db)
  await sql`CREATE INDEX pt_subscription_intercessor_idx ON pt_subscription (intercessor_id)`.execute(db)
  await sql`CREATE UNIQUE INDEX pt_subscription_verify_uniq ON pt_subscription (verify_token_hash) WHERE verify_token_hash IS NOT NULL`.execute(db)
  await sql`CREATE INDEX pt_subscription_unverified_idx ON pt_subscription (created_at) WHERE verified_at IS NULL AND delivery = 'email'`.execute(db)
  await scopeToOrg(db, 'pt_subscription')

  await sql`
    CREATE TABLE pt_commitment (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      subscription_id uuid NOT NULL REFERENCES pt_subscription(id) ON DELETE CASCADE,
      campaign_id uuid NOT NULL REFERENCES pt_campaign(id) ON DELETE CASCADE,
      kind text NOT NULL DEFAULT 'recurring' CHECK (kind IN ('recurring', 'dates')),
      frequency text CHECK (frequency IN ('daily', 'weekly')),
      days_of_week smallint[] NOT NULL DEFAULT '{}',
      time text NOT NULL CHECK (time ~ '^[0-2][0-9]:[0-5][0-9]$'),
      timezone text NOT NULL,
      duration_min integer CHECK (duration_min IS NULL OR duration_min BETWEEN 1 AND 1440),
      dates timestamptz[] NOT NULL DEFAULT '{}',
      starts_on date NOT NULL,
      ends_on date,
      paused boolean NOT NULL DEFAULT false,
      next_reminder_utc timestamptz,
      claimed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (kind = 'dates' OR frequency IS NOT NULL),
      CHECK (frequency <> 'weekly' OR cardinality(days_of_week) > 0)
    )
  `.execute(db)
  await sql`CREATE INDEX pt_commitment_due_idx ON pt_commitment (next_reminder_utc) WHERE next_reminder_utc IS NOT NULL AND NOT paused`.execute(db)
  await sql`CREATE INDEX pt_commitment_subscription_idx ON pt_commitment (subscription_id)`.execute(db)
  await sql`CREATE INDEX pt_commitment_campaign_idx ON pt_commitment (campaign_id)`.execute(db)
  await scopeToOrg(db, 'pt_commitment')

  await sql`
    CREATE TABLE pt_reminder_sent (
      commitment_id uuid NOT NULL REFERENCES pt_commitment(id) ON DELETE CASCADE,
      org_id uuid NOT NULL DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      local_date date NOT NULL,
      sent_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (commitment_id, local_date)
    )
  `.execute(db)
  await scopeToOrg(db, 'pt_reminder_sent')

  await sql`
    CREATE TABLE pt_checkin (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      subscription_id uuid NOT NULL REFERENCES pt_subscription(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('checkin', 'reminder', 'manual')),
      token_hash text,
      sent_at timestamptz NOT NULL DEFAULT now(),
      response text CHECK (response IN ('yes', 'sometimes', 'no')),
      responded_at timestamptz
    )
  `.execute(db)
  await sql`CREATE INDEX pt_checkin_subscription_idx ON pt_checkin (subscription_id, sent_at DESC)`.execute(db)
  await sql`CREATE UNIQUE INDEX pt_checkin_token_uniq ON pt_checkin (token_hash) WHERE token_hash IS NOT NULL`.execute(db)
  await scopeToOrg(db, 'pt_checkin')

  // Prayer sessions: upserted per session from pings, partitioned monthly so
  // raw rows older than two years drop by partition.
  await sql`
    CREATE TABLE pt_prayer_session (
      id uuid NOT NULL,
      org_id uuid NOT NULL DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      campaign_id uuid,
      subscription_id uuid,
      intercessor_id uuid,
      source text NOT NULL,
      day integer,
      language text,
      country text,
      started_at timestamptz NOT NULL DEFAULT now(),
      last_ping_at timestamptz NOT NULL DEFAULT now(),
      seconds integer NOT NULL DEFAULT 0,
      completed boolean NOT NULL DEFAULT false,
      group_size integer NOT NULL DEFAULT 1,
      PRIMARY KEY (id, started_at)
    ) PARTITION BY RANGE (started_at)
  `.execute(db)
  await sql`CREATE INDEX pt_prayer_session_org_ping_idx ON pt_prayer_session (org_id, last_ping_at)`.execute(db)
  await sql`CREATE INDEX pt_prayer_session_id_idx ON pt_prayer_session (id)`.execute(db)
  await sql`CREATE TABLE pt_prayer_session_default PARTITION OF pt_prayer_session DEFAULT`.execute(db)
  await sql`
    CREATE OR REPLACE FUNCTION pt_ensure_session_partitions(months_ahead integer) RETURNS void
      LANGUAGE plpgsql AS
    $$
    DECLARE
      m date := date_trunc('month', now())::date;
      i integer;
      part text;
    BEGIN
      FOR i IN 0..months_ahead LOOP
        part := 'pt_prayer_session_' || to_char(m + (i || ' month')::interval, 'YYYYMM');
        IF to_regclass(part) IS NULL THEN
          EXECUTE format(
            'CREATE TABLE %I PARTITION OF pt_prayer_session FOR VALUES FROM (%L) TO (%L)',
            part, m + (i || ' month')::interval, m + ((i + 1) || ' month')::interval
          );
        END IF;
      END LOOP;
    END
    $$
  `.execute(db)
  await sql`SELECT pt_ensure_session_partitions(2)`.execute(db)
  await scopeToOrg(db, 'pt_prayer_session')

  await sql`
    CREATE TABLE pt_person_total (
      org_id uuid NOT NULL DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      campaign_id uuid NOT NULL REFERENCES pt_campaign(id) ON DELETE CASCADE,
      subscription_id uuid NOT NULL REFERENCES pt_subscription(id) ON DELETE CASCADE,
      prayers integer NOT NULL DEFAULT 0,
      seconds bigint NOT NULL DEFAULT 0,
      last_prayed_at timestamptz,
      PRIMARY KEY (campaign_id, subscription_id)
    )
  `.execute(db)
  await scopeToOrg(db, 'pt_person_total')

  await sql`
    CREATE TABLE pt_stat_daily (
      org_id uuid NOT NULL DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      campaign_id uuid,
      day date NOT NULL,
      metric text NOT NULL,
      value bigint NOT NULL DEFAULT 0
    )
  `.execute(db)
  await sql`
    CREATE UNIQUE INDEX pt_stat_daily_uniq ON pt_stat_daily
      (org_id, (coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid)), day, metric)
  `.execute(db)
  await scopeToOrg(db, 'pt_stat_daily')

  await sql`
    CREATE TABLE pt_stat_dim_daily (
      org_id uuid NOT NULL DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      campaign_id uuid,
      day date NOT NULL,
      dim text NOT NULL,
      key text NOT NULL,
      value bigint NOT NULL DEFAULT 0
    )
  `.execute(db)
  await sql`
    CREATE UNIQUE INDEX pt_stat_dim_daily_uniq ON pt_stat_dim_daily
      (org_id, (coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid)), day, dim, key)
  `.execute(db)
  await scopeToOrg(db, 'pt_stat_dim_daily')

  await sql`
    CREATE TABLE pt_stat_visitor_day (
      org_id uuid NOT NULL DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      day date NOT NULL,
      visitor_hash text NOT NULL,
      PRIMARY KEY (org_id, day, visitor_hash)
    )
  `.execute(db)
  await scopeToOrg(db, 'pt_stat_visitor_day')

  await sql`
    CREATE TABLE pt_event (
      id bigserial PRIMARY KEY,
      org_id uuid NOT NULL DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      campaign_id uuid,
      type text NOT NULL,
      visitor_hash text,
      country text,
      source text,
      meta jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)
  await sql`CREATE INDEX pt_event_org_created_idx ON pt_event (org_id, created_at)`.execute(db)
  await scopeToOrg(db, 'pt_event')

  await sql`
    CREATE TABLE pt_story (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      campaign_id uuid REFERENCES pt_campaign(id) ON DELETE SET NULL,
      conversation_id uuid,
      name text,
      body text NOT NULL,
      language text NOT NULL,
      may_publish boolean NOT NULL DEFAULT false,
      may_platform boolean NOT NULL DEFAULT false,
      use_name boolean NOT NULL DEFAULT false,
      wording_version text NOT NULL,
      published boolean NOT NULL DEFAULT false,
      published_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)
  await scopeToOrg(db, 'pt_story')

  await sql`
    CREATE TABLE pt_consent_option (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      key text NOT NULL,
      label jsonb NOT NULL,
      active boolean NOT NULL DEFAULT true,
      position integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (org_id, key)
    )
  `.execute(db)
  await scopeToOrg(db, 'pt_consent_option')

  await sql`
    CREATE TABLE pt_signup_field (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      key text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('text', 'select', 'checkbox')),
      label jsonb NOT NULL,
      options jsonb NOT NULL DEFAULT '[]'::jsonb,
      required boolean NOT NULL DEFAULT false,
      position integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (org_id, key)
    )
  `.execute(db)
  await scopeToOrg(db, 'pt_signup_field')

  await sql`
    CREATE TABLE pt_site_string (
      org_id uuid NOT NULL DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      key text NOT NULL,
      language text NOT NULL,
      value text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (org_id, key, language)
    )
  `.execute(db)
  await scopeToOrg(db, 'pt_site_string')

  await sql`
    CREATE TABLE pt_export_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      row_count integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)
  await scopeToOrg(db, 'pt_export_log')

  await sql`
    CREATE TABLE pt_coverage_cache (
      org_id uuid NOT NULL DEFAULT current_org_id() REFERENCES orgs(id) ON DELETE CASCADE,
      campaign_id uuid PRIMARY KEY REFERENCES pt_campaign(id) ON DELETE CASCADE,
      slots jsonb NOT NULL,
      computed_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)
  await scopeToOrg(db, 'pt_coverage_cache')

  // ── Person scope ─────────────────────────────────────────────────────────
  // The intercessor app and the My prayer page run as the person
  // (`app.current_intercessor`) and read their own subscriptions across sites.
  await sql`
    CREATE POLICY person_read ON pt_subscription FOR SELECT
      USING (intercessor_id = current_intercessor_id())
  `.execute(db)
  await sql`
    CREATE POLICY person_read ON pt_commitment FOR SELECT
      USING (subscription_id IN (SELECT id FROM pt_subscription WHERE intercessor_id = current_intercessor_id()))
  `.execute(db)
  await sql`
    CREATE POLICY person_read ON pt_person_total FOR SELECT
      USING (subscription_id IN (SELECT id FROM pt_subscription WHERE intercessor_id = current_intercessor_id()))
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of [
    'pt_coverage_cache', 'pt_export_log', 'pt_site_string', 'pt_signup_field', 'pt_consent_option',
    'pt_story', 'pt_event', 'pt_stat_visitor_day', 'pt_stat_dim_daily', 'pt_stat_daily', 'pt_person_total',
    'pt_prayer_session', 'pt_checkin', 'pt_reminder_sent', 'pt_commitment', 'pt_subscription',
    'pt_campaign_library', 'pt_site_entry', 'pt_site_library', 'pt_campaign', 'pt_site',
    'pt_legacy_key', 'pt_personal_block', 'pt_personal_asset', 'pt_library_entry', 'pt_library',
    'pt_site_report', 'pt_directory_entry', 'pt_site_domain', 'pt_job', 'pt_suppression',
    'pt_my_session', 'pt_my_token', 'pt_intercessor_device', 'pt_intercessor'
  ]) {
    await sql`DROP TABLE IF EXISTS ${sql.ref(t)} CASCADE`.execute(db)
  }
  await sql`DROP FUNCTION IF EXISTS pt_ensure_session_partitions(integer)`.execute(db)
  await sql`DROP FUNCTION IF EXISTS current_intercessor_id()`.execute(db)
}
