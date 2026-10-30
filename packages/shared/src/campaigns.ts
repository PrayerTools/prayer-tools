// Loading a site's campaigns and addressing their pages. Reads run inside the
// site's org; `orgId` narrows them on a connection that bypasses RLS.
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
