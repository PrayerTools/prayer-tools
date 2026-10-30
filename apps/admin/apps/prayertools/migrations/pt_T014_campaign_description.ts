// Every campaign has its own short description and template; main campaigns
// take their site's. The site keeps neither, nor its unused purpose.
import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE pt_campaign c
    SET description = coalesce(c.description, s.description), template_key = coalesce(c.template_key, s.template_key)
    FROM pt_site s
    WHERE s.org_id = c.org_id AND c.kind IS NULL
  `.execute(db)
  await sql`
    ALTER TABLE pt_site
      DROP COLUMN description,
      DROP COLUMN template_key,
      DROP COLUMN purpose
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE pt_site
      ADD COLUMN description jsonb,
      ADD COLUMN template_key text,
      ADD COLUMN purpose text
  `.execute(db)
  await sql`
    UPDATE pt_site s
    SET description = c.description, template_key = c.template_key
    FROM (
      SELECT DISTINCT ON (org_id) * FROM pt_campaign WHERE kind IS NULL ORDER BY org_id, start_date DESC NULLS LAST, created_at DESC
    ) c
    WHERE c.org_id = s.org_id
  `.execute(db)
}
