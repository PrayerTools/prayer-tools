import { type Kysely, sql } from 'kysely'

// The mail kernel's `mail_suppressions` is the one suppression list. Rows from
// `pt_suppression` were learned for every site at once, so they move over as
// global rows; both tables store the same sha256 of the trimmed, lowercased
// address.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    insert into mail_suppressions (address_hash, org_id, scope, reason, detail, source, occurred_at, created_at)
    select address_hash, null, 'global', reason, detail, source, created_at, created_at
    from pt_suppression
    on conflict do nothing
  `.execute(db)
  await sql`DROP TABLE pt_suppression`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
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
}
