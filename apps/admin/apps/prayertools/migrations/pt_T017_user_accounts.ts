// Every person is a Nuxtinator user. Each `pt_intercessor` becomes a `users`
// row (the existing account when its verified address already has one; an
// account without an address for an app install), and everything that
// pointed at the intercessor points at the user: subscriptions, prayer
// sessions, app devices (`pt_user_device`), and each site's CRM contact
// (`crm_records.user_id`, from crm_011). The My prayer token and session
// tables give way to `pt_auth_code` and `pt_account_session`.
// Person scope (`app.current_intercessor`) now holds a user id.
import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TEMP TABLE pt_account_map ON COMMIT DROP AS
    SELECT i.id AS intercessor_id, coalesce(u.id, i.id) AS user_id, u.id IS NULL AS new_user,
           i.email, i.email_verified_at, i.created_at
    FROM pt_intercessor i
    LEFT JOIN users u ON i.email IS NOT NULL AND lower(u.email) = lower(i.email)
  `.execute(db)
  await sql`
    INSERT INTO users (id, created, updated, email, display_name, verified)
    SELECT user_id, created_at, created_at, lower(email), '', email_verified_at IS NOT NULL
    FROM pt_account_map WHERE new_user
  `.execute(db)
  // An unverified account whose address a person proved here gets verified,
  // and loses what whoever registered the address set up (see markAccountVerified).
  await sql`
    CREATE TEMP TABLE pt_account_proved ON COMMIT DROP AS
    SELECT u.id FROM users u JOIN pt_account_map m ON m.user_id = u.id
    WHERE NOT m.new_user AND m.email_verified_at IS NOT NULL AND NOT u.verified
  `.execute(db)
  await sql`UPDATE users SET verified = true, password = NULL WHERE id IN (SELECT id FROM pt_account_proved)`.execute(db)
  await sql`DELETE FROM sessions WHERE user_id IN (SELECT id FROM pt_account_proved)`.execute(db)
  await sql`DELETE FROM user_identities WHERE user_id IN (SELECT id FROM pt_account_proved)`.execute(db)
  await sql`DELETE FROM password_reset_requests WHERE user_id IN (SELECT id FROM pt_account_proved)`.execute(db)

  // Person-scope policies name the old column; they come back below.
  await sql`DROP POLICY person_read ON pt_person_total`.execute(db)
  await sql`DROP POLICY person_read ON pt_commitment`.execute(db)
  await sql`DROP POLICY person_read ON pt_subscription`.execute(db)

  await sql`ALTER TABLE pt_subscription ADD COLUMN user_id uuid REFERENCES users(id) ON DELETE SET NULL`.execute(db)
  await sql`UPDATE pt_subscription s SET user_id = m.user_id FROM pt_account_map m WHERE m.intercessor_id = s.intercessor_id`.execute(db)
  await sql`DROP INDEX pt_subscription_app_uniq`.execute(db)
  await sql`DROP INDEX pt_subscription_intercessor_idx`.execute(db)
  await sql`ALTER TABLE pt_subscription DROP COLUMN intercessor_id`.execute(db)
  await sql`CREATE UNIQUE INDEX pt_subscription_app_uniq ON pt_subscription (org_id, user_id) WHERE delivery = 'app'`.execute(db)
  await sql`CREATE INDEX pt_subscription_user_idx ON pt_subscription (user_id)`.execute(db)

  await sql`ALTER TABLE pt_prayer_session RENAME COLUMN intercessor_id TO user_id`.execute(db)
  await sql`UPDATE pt_prayer_session p SET user_id = m.user_id FROM pt_account_map m WHERE m.intercessor_id = p.user_id AND NOT m.new_user`.execute(db)

  await sql`ALTER TABLE pt_intercessor_device RENAME TO pt_user_device`.execute(db)
  await sql`ALTER TABLE pt_user_device DROP CONSTRAINT pt_intercessor_device_intercessor_id_fkey`.execute(db)
  await sql`ALTER TABLE pt_user_device RENAME COLUMN intercessor_id TO user_id`.execute(db)
  await sql`UPDATE pt_user_device d SET user_id = m.user_id FROM pt_account_map m WHERE m.intercessor_id = d.user_id AND NOT m.new_user`.execute(db)
  await sql`ALTER TABLE pt_user_device ADD CONSTRAINT pt_user_device_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`.execute(db)
  await sql`ALTER INDEX pt_intercessor_device_intercessor_idx RENAME TO pt_user_device_user_idx`.execute(db)

  // Contacts of verified subscriptions, then the staff org's platform-news
  // contact whose verified address is a verified account's.
  await sql`
    UPDATE crm_records r SET user_id = s.user_id
    FROM pt_subscription s
    WHERE s.contact_id = r.id AND s.user_id IS NOT NULL AND s.verified_at IS NOT NULL AND r.user_id IS NULL
  `.execute(db)
  await sql`
    UPDATE crm_records r SET user_id = x.user_id
    FROM (
      SELECT DISTINCT ON (r2.id) r2.id AS record_id, u.id AS user_id
      FROM crm_records r2
      JOIN crm_contact_channels cc ON cc.record_id = r2.id
      JOIN crm_channels ch ON ch.id = cc.channel_id AND ch.channel_type = 'email' AND ch.verified
      JOIN users u ON lower(u.email) = ch.normalized_value AND u.verified
      WHERE r2.record_type = 'contacts' AND r2.user_id IS NULL
        AND r2.org_id = (SELECT id FROM orgs WHERE slug = 'staff')
        AND NOT EXISTS (SELECT 1 FROM crm_records o WHERE o.org_id = r2.org_id AND o.record_type = 'contacts' AND o.user_id = u.id)
      ORDER BY r2.id, cc.is_primary DESC
    ) x
    WHERE r.id = x.record_id
  `.execute(db)
  await sql`
    UPDATE users u SET display_name = left(r.name, 200)
    FROM crm_records r
    WHERE r.user_id = u.id AND u.display_name = '' AND r.name <> 'Anonymized' AND r.name <> split_part(coalesce(u.email, ''), '@', 1)
  `.execute(db)

  await sql`
    CREATE POLICY person_read ON pt_subscription FOR SELECT
      USING (user_id = current_intercessor_id())
  `.execute(db)
  await sql`
    CREATE POLICY person_read ON pt_commitment FOR SELECT
      USING (subscription_id IN (SELECT id FROM pt_subscription WHERE user_id = current_intercessor_id()))
  `.execute(db)
  await sql`
    CREATE POLICY person_read ON pt_person_total FOR SELECT
      USING (subscription_id IN (SELECT id FROM pt_subscription WHERE user_id = current_intercessor_id()))
  `.execute(db)

  await sql`DROP TABLE pt_my_session`.execute(db)
  await sql`DROP TABLE pt_my_token`.execute(db)
  await sql`DROP TABLE pt_intercessor`.execute(db)

  // Single-use codes: emailed sign-in links, hand-offs of a sign-in to another
  // host, and confirmations of a new address. Stored hashed.
  await sql`
    CREATE TABLE pt_auth_code (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose text NOT NULL CHECK (purpose IN ('sign_in', 'handoff', 'email_change')),
      code_hash text NOT NULL UNIQUE,
      host text,
      email text,
      return_to text,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)
  await sql`CREATE INDEX pt_auth_code_expires_idx ON pt_auth_code (expires_at)`.execute(db)

  // Sign-ins on the public server, each valid only on the host it was issued
  // for. Kept apart from core's `sessions` so they never become admin sign-ins.
  await sql`
    CREATE TABLE pt_account_session (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      host text NOT NULL,
      token_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_used_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      user_agent text,
      ip text
    )
  `.execute(db)
  await sql`CREATE INDEX pt_account_session_user_idx ON pt_account_session (user_id)`.execute(db)
  await sql`CREATE INDEX pt_account_session_expires_idx ON pt_account_session (expires_at)`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE pt_account_session`.execute(db)
  await sql`DROP TABLE pt_auth_code`.execute(db)
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
    INSERT INTO pt_intercessor (id, email, email_verified_at, created_at)
    SELECT u.id, CASE WHEN u.verified THEN u.email END, CASE WHEN u.verified THEN u.created END, u.created FROM users u
    WHERE EXISTS (SELECT 1 FROM pt_subscription s WHERE s.user_id = u.id) OR EXISTS (SELECT 1 FROM pt_user_device d WHERE d.user_id = u.id)
  `.execute(db)
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

  await sql`DROP POLICY person_read ON pt_person_total`.execute(db)
  await sql`DROP POLICY person_read ON pt_commitment`.execute(db)
  await sql`DROP POLICY person_read ON pt_subscription`.execute(db)

  await sql`UPDATE crm_records SET user_id = NULL WHERE user_id IS NOT NULL`.execute(db)

  await sql`ALTER INDEX pt_user_device_user_idx RENAME TO pt_intercessor_device_intercessor_idx`.execute(db)
  await sql`ALTER TABLE pt_user_device DROP CONSTRAINT pt_user_device_user_id_fkey`.execute(db)
  await sql`ALTER TABLE pt_user_device RENAME COLUMN user_id TO intercessor_id`.execute(db)
  await sql`ALTER TABLE pt_user_device RENAME TO pt_intercessor_device`.execute(db)
  await sql`ALTER TABLE pt_intercessor_device ADD CONSTRAINT pt_intercessor_device_intercessor_id_fkey FOREIGN KEY (intercessor_id) REFERENCES pt_intercessor(id) ON DELETE CASCADE`.execute(db)

  await sql`ALTER TABLE pt_prayer_session RENAME COLUMN user_id TO intercessor_id`.execute(db)

  await sql`ALTER TABLE pt_subscription ADD COLUMN intercessor_id uuid REFERENCES pt_intercessor(id) ON DELETE SET NULL`.execute(db)
  await sql`UPDATE pt_subscription SET intercessor_id = user_id`.execute(db)
  await sql`DROP INDEX pt_subscription_app_uniq`.execute(db)
  await sql`DROP INDEX pt_subscription_user_idx`.execute(db)
  await sql`ALTER TABLE pt_subscription DROP COLUMN user_id`.execute(db)
  await sql`CREATE UNIQUE INDEX pt_subscription_app_uniq ON pt_subscription (org_id, intercessor_id) WHERE delivery = 'app'`.execute(db)
  await sql`CREATE INDEX pt_subscription_intercessor_idx ON pt_subscription (intercessor_id)`.execute(db)

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
