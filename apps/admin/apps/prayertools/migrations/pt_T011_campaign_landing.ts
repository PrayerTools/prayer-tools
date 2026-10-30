// Each campaign has its own landing page, hero image, link-preview image and
// share messages. The site keeps its color and logo.
import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE pt_campaign
      ADD COLUMN branding jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN share jsonb NOT NULL DEFAULT '{}'::jsonb
  `.execute(db)
  await sql`
    UPDATE pt_campaign c SET
      landing = CASE WHEN c.kind IS NULL THEN coalesce(c.landing, s.landing, '{}'::jsonb) ELSE coalesce(c.landing, '{}'::jsonb) END,
      branding = jsonb_strip_nulls(jsonb_build_object(
        'image_asset_id', s.branding -> 'image_asset_id',
        'image_url', s.branding -> 'image_url',
        'image_alt', s.branding -> 'image_alt',
        'image_credit', s.branding -> 'image_credit',
        'focal_x', s.branding -> 'focal_x',
        'focal_y', s.branding -> 'focal_y',
        'share_image_url', s.branding -> 'share_image_url'
      )),
      share = coalesce(s.share, '{}'::jsonb)
    FROM pt_site s
    WHERE s.org_id = c.org_id
  `.execute(db)
  await sql`
    ALTER TABLE pt_campaign
      ALTER COLUMN landing SET DEFAULT '{}'::jsonb,
      ALTER COLUMN landing SET NOT NULL
  `.execute(db)
  await sql`
    UPDATE pt_site SET branding = branding
      - ARRAY['image_asset_id', 'image_url', 'image_alt', 'image_credit', 'focal_x', 'focal_y', 'share_image_url']
  `.execute(db)
  await sql`ALTER TABLE pt_site DROP COLUMN landing, DROP COLUMN share`.execute(db)
}

// The site takes back the landing page, images and share messages of its
// most recent main campaign.
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE pt_site
      ADD COLUMN landing jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN share jsonb NOT NULL DEFAULT '{}'::jsonb
  `.execute(db)
  await sql`
    UPDATE pt_site s SET
      landing = c.landing,
      share = c.share,
      branding = s.branding || c.branding
    FROM (
      SELECT DISTINCT ON (org_id) org_id, landing, share, branding
      FROM pt_campaign
      WHERE kind IS NULL
      ORDER BY org_id, start_date DESC NULLS LAST, created_at DESC
    ) c
    WHERE c.org_id = s.org_id
  `.execute(db)
  await sql`
    ALTER TABLE pt_campaign
      ALTER COLUMN landing DROP NOT NULL,
      ALTER COLUMN landing DROP DEFAULT,
      DROP COLUMN share,
      DROP COLUMN branding
  `.execute(db)
  await sql`UPDATE pt_campaign SET landing = NULL WHERE kind IS NULL`.execute(db)
}
