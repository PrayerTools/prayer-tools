// Loading a site's campaigns and addressing their pages. Reads run inside the
// site's org; `orgId` narrows them on a connection that bypasses RLS.
import { sql } from 'kysely'
import type { Tx } from './db/scope'
import type { CampaignRow } from './subscriptions'
import { toIsoDate } from './dates'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// DATE columns as `YYYY-MM-DD`, whichever driver read the row.
export function normalizeCampaign<T extends { start_date: unknown, end_date: unknown }>(c: T): T & { start_date: string | null, end_date: string | null } {
  return { ...c, start_date: toIsoDate(c.start_date as Date | string | null), end_date: toIsoDate(c.end_date as Date | string | null) }
}

export interface CampaignQuery {
  // Include draft campaigns (preview links, the admin app).
  drafts?: boolean
  orgId?: string
}

// The site's campaigns with ISO dates, earliest start first and
// personal-start campaigns last. Drafts are left out unless asked for.
export async function loadCampaigns(tx: Tx, opts: CampaignQuery = {}): Promise<CampaignRow[]> {
  let q = tx.selectFrom('pt_campaign').selectAll()
  if (opts.orgId) q = q.where('org_id', '=', opts.orgId)
  if (!opts.drafts) q = q.where('published_at', 'is not', null)
  const rows = await q.orderBy('start_date', 'asc').orderBy('created_at', 'asc').execute()
  return rows.map(normalizeCampaign) as CampaignRow[]
}

// One campaign by id, or null for an unknown id, a malformed one, or a draft
// unless asked for.
export async function campaignById(tx: Tx, id: unknown, opts: CampaignQuery = {}): Promise<CampaignRow | null> {
  if (typeof id !== 'string' || !UUID_RE.test(id)) return null
  let q = tx.selectFrom('pt_campaign').selectAll().where('id', '=', id)
  if (opts.orgId) q = q.where('org_id', '=', opts.orgId)
  if (!opts.drafts) q = q.where('published_at', 'is not', null)
  const row = await q.executeTakeFirst()
  return row ? normalizeCampaign(row) as CampaignRow : null
}

// Every run of a campaign, oldest first: all campaigns relaunched, directly
// or in turn, from the same first campaign, including the one asked about.
// Relaunching one campaign twice puts both relaunches in its series.
export async function campaignSeries(tx: Tx, campaignId: string, opts: CampaignQuery = {}): Promise<CampaignRow[]> {
  if (!UUID_RE.test(campaignId)) return []
  const ids = sql`
    WITH RECURSIVE up AS (
      SELECT id, relaunch_of FROM pt_campaign WHERE id = ${campaignId}
      UNION ALL
      SELECT c.id, c.relaunch_of FROM pt_campaign c JOIN up ON c.id = up.relaunch_of
    ), down AS (
      SELECT id FROM up WHERE relaunch_of IS NULL
      UNION ALL
      SELECT c.id FROM pt_campaign c JOIN down ON c.relaunch_of = down.id
    )
    SELECT id FROM down`
  let q = tx.selectFrom('pt_campaign').selectAll().where(sql<boolean>`id IN (${ids})`)
  if (opts.orgId) q = q.where('org_id', '=', opts.orgId)
  if (!opts.drafts) q = q.where('published_at', 'is not', null)
  const rows = await q.orderBy('created_at', 'asc').execute()
  return rows.map(normalizeCampaign) as CampaignRow[]
}

// The path segment of a campaign's pages: none for the site's current
// campaign, which has the root address, and its slug for any other.
export function campaignSegment(c: { id: string, slug: string }, currentId: string | null | undefined): string | null {
  return c.id === currentId ? null : c.slug
}

// A campaign's landing page address on the site.
export function campaignUrl(siteUrl: string, c: { id: string, slug: string }, currentId: string | null | undefined): string {
  const segment = campaignSegment(c, currentId)
  return segment ? `${siteUrl}/${segment}` : siteUrl
}

// Campaign fields `pt.messages.write` covers as well as `pt.campaigns.write`:
// the share message and image, and the end-of-campaign message and call to action.
export const CAMPAIGN_MESSAGE_FIELDS = ['share', 'share_image_url', 'end_message', 'cta']
// Landing page fields, which also need `pt.site.write`.
const CAMPAIGN_LANDING_FIELDS = ['landing', 'description', 'branding']

// The first permission a campaign edit touching `fields` needs and `perms`
// lacks, or null when the edit is allowed.
export function campaignEditMissing(fields: string[], perms: ReadonlySet<string>): string | null {
  if (!perms.has('pt.campaigns.write') && !perms.has('pt.messages.write')) return 'pt.campaigns.write'
  if (!perms.has('pt.campaigns.write') && fields.some(f => !CAMPAIGN_MESSAGE_FIELDS.includes(f))) return 'pt.campaigns.write'
  if (!perms.has('pt.site.write') && fields.some(f => CAMPAIGN_LANDING_FIELDS.includes(f))) return 'pt.site.write'
  return null
}
