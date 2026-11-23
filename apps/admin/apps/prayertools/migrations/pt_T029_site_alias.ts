// A site's former hostnames (WordPress-era addresses such as
// `yemen.pray4movement.org`). Requests to one redirect to the site's address,
// so old links keep working. Read before any org scope, like pt_site_domain.
import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE pt_site_alias (
      hostname text PRIMARY KEY CHECK (hostname = lower(hostname)),
      org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)
  await sql`CREATE INDEX pt_site_alias_org_idx ON pt_site_alias (org_id)`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE pt_site_alias`.execute(db)
}
