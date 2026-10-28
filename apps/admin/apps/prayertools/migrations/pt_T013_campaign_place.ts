// Each campaign has its own place (name, coordinates and per-language
// wording) and people group. Existing campaigns take their site's.
import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE pt_campaign
      ADD COLUMN place_name text,
      ADD COLUMN place_wording jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN people_group text,
      ADD COLUMN latitude double precision,
      ADD COLUMN longitude double precision
  `.execute(db)
  await sql`
    UPDATE pt_campaign c
    SET place_name = s.place_name, place_wording = s.place_wording, people_group = s.people_group, latitude = s.latitude, longitude = s.longitude
    FROM pt_site s
    WHERE s.org_id = c.org_id
  `.execute(db)
  await sql`
    ALTER TABLE pt_site
      DROP COLUMN place_name,
      DROP COLUMN place_wording,
      DROP COLUMN people_group,
      DROP COLUMN latitude,
      DROP COLUMN longitude
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE pt_site
      ADD COLUMN place_name text,
      ADD COLUMN place_wording jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN people_group text,
      ADD COLUMN latitude double precision,
      ADD COLUMN longitude double precision
  `.execute(db)
  await sql`
    UPDATE pt_site s
    SET place_name = c.place_name, place_wording = c.place_wording, people_group = c.people_group, latitude = c.latitude, longitude = c.longitude
    FROM (
      SELECT DISTINCT ON (org_id) * FROM pt_campaign WHERE kind IS NULL ORDER BY org_id, start_date DESC NULLS LAST, created_at DESC
    ) c
    WHERE c.org_id = s.org_id
  `.execute(db)
  await sql`
    ALTER TABLE pt_campaign
      DROP COLUMN place_name,
      DROP COLUMN place_wording,
      DROP COLUMN people_group,
      DROP COLUMN latitude,
      DROP COLUMN longitude
  `.execute(db)
}
