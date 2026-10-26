// Per-site stats for relayed analytics events (web and app), recorded before
// forwarding to Statinator.
import { createHash } from 'node:crypto'
import type { Tx } from '@prayertools/shared/db/scope'
import { bumpDim, bumpStat, recordEvent, recordVisitor } from '@prayertools/shared/stats'
import { todayIn } from '@prayertools/shared/dates'
import { pickCurrentCampaign } from '@prayertools/shared/setup'
import { parseSitePath } from '@prayertools/shared/paths'
import { normalizeCampaign, type CampaignRow } from '@prayertools/shared/subscriptions'

export const WEB_EVENTS = new Set(['pageview', 'campaign_shared', 'language_switched', 'signup_cta_clicked', 'app_link_clicked'])
export const APP_EVENTS = new Set(['app_open', 'language_switched', 'campaign_shared'])

export interface CollectInput {
  type: string
  anonymousId: string | null
  country: string | null
  url: string | null
  referrer: string | null
  ownHost: string | null
  metadata: Record<string, unknown>
}

export function visitorHash(orgId: string, anonymousId: string): string {
  return createHash('sha256').update(`${orgId}:${anonymousId}`).digest('hex').slice(0, 32)
}

function hostOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

// The campaign a page belongs to: the one its address names (a past or side
// campaign), else the site's current campaign.
export async function campaignOfPage(tx: Tx, url: string | null): Promise<{ id: string, timezone: string } | null> {
  const rows = (await tx.selectFrom('pt_campaign').selectAll().execute()).map(normalizeCampaign) as CampaignRow[]
  let named: CampaignRow | undefined
  if (url) {
    try {
      const site = await tx.selectFrom('pt_site').select('languages').executeTakeFirst()
      const slug = parseSitePath(new URL(url).pathname, site?.languages ?? [], rows.map(r => r.slug)).campaignSlug
      named = rows.find(r => r.slug === slug)
    } catch {
      named = undefined
    }
  }
  const c = named ?? pickCurrentCampaign(rows)?.campaign
  return c ? { id: c.id, timezone: c.timezone } : null
}

export async function recordCollect(tx: Tx, orgId: string, siteTimezone: string, e: CollectInput): Promise<string | null> {
  const campaign = await campaignOfPage(tx, e.url)
  const cid = campaign?.id ?? null
  const day = todayIn(campaign?.timezone ?? siteTimezone)
  const vh = e.anonymousId ? visitorHash(orgId, e.anonymousId) : null
  const refHost = hostOf(e.referrer)
  const external = refHost && refHost !== e.ownHost?.split(':')[0] ? refHost : null
  const utmSource = typeof e.metadata.utm_source === 'string' ? e.metadata.utm_source : null
  const source = utmSource ?? (typeof e.metadata.referral === 'string' ? 'share' : external)
  if (e.type === 'pageview') {
    await bumpStat(tx, cid, day, 'pageviews')
    if (vh && await recordVisitor(tx, day, vh)) await bumpStat(tx, cid, day, 'visitors')
    if (e.country) await bumpDim(tx, cid, day, 'country', e.country)
    if (source) await bumpDim(tx, cid, day, 'source', source)
    if (external) await bumpDim(tx, cid, day, 'referrer', external)
    for (const k of ['utm_medium', 'utm_campaign'] as const) {
      const v = e.metadata[k]
      if (typeof v === 'string' && v) await bumpDim(tx, cid, day, k, v)
    }
  }
  if (e.type === 'campaign_shared') {
    await bumpStat(tx, cid, day, 'shares')
    const channel = typeof e.metadata.channel === 'string' ? e.metadata.channel : 'other'
    await bumpDim(tx, cid, day, 'share_channel', channel)
  }
  let path: string | null = null
  try {
    path = e.url ? new URL(e.url).pathname.slice(0, 200) : null
  } catch {
    path = null
  }
  await recordEvent(tx, { campaignId: cid, type: e.type, visitorHash: vh, country: e.country, source, meta: { path } })
  return cid
}
