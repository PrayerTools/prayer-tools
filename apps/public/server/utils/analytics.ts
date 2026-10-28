// Server-side analytics: per-site stats are written by the callers; this
// forwards events to Statinator in the background with the visitor's geo,
// the campaign's coordinates and site metadata.
import type { H3Event } from 'h3'
import { withOrg } from '@prayertools/shared/db/scope'
import { forwardEvent, geoFromHeaders, type StatinatorEvent } from '@prayertools/shared/statinator'
import { useDb } from './db'
import { background } from './request'

interface SiteGeo {
  lat: number | null
  lng: number | null
  timezone: string
}

const geoCache = new Map<string, { value: SiteGeo, expires: number }>()

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The site's timezone, and the coordinates of `campaignId`, or of the latest
// main campaign when that campaign has none.
export async function siteGeo(orgId: string, campaignId?: string | null): Promise<SiteGeo> {
  const id = campaignId && UUID.test(campaignId) ? campaignId : null
  const key = `${orgId}:${id ?? ''}`
  const hit = geoCache.get(key)
  if (hit && hit.expires > Date.now()) return hit.value
  const value = await withOrg(useDb(), orgId, async (tx) => {
    const site = await tx.selectFrom('pt_site').select('timezone').executeTakeFirst()
    const placed = tx.selectFrom('pt_campaign').select(['latitude', 'longitude']).where('latitude', 'is not', null).where('longitude', 'is not', null)
    const own = id ? await placed.where('id', '=', id).executeTakeFirst() : undefined
    const place = own ?? await placed.where('kind', 'is', null).orderBy('start_date', ob => ob.desc().nullsLast()).orderBy('created_at', 'desc').executeTakeFirst()
    return { lat: place?.latitude ?? null, lng: place?.longitude ?? null, timezone: site?.timezone ?? 'UTC' }
  })
  geoCache.set(key, { value, expires: Date.now() + 60_000 })
  return value
}

export interface SiteRef {
  orgId: string
  slug: string
  host?: string
}

export interface ForwardInput extends Omit<StatinatorEvent, 'geo' | 'hostname' | 'target_latitude' | 'target_longitude'> {
  campaignId?: string | null
}

async function build(event: H3Event, site: SiteRef, e: ForwardInput): Promise<StatinatorEvent> {
  const geo = await siteGeo(site.orgId, e.campaignId).catch(() => null)
  const { campaignId, metadata, ...rest } = e
  return {
    ...rest,
    hostname: site.host ?? null,
    geo: geoFromHeaders(name => getRequestHeader(event, name)),
    userAgent: getRequestHeader(event, 'user-agent') ?? null,
    target_latitude: geo?.lat ?? null,
    target_longitude: geo?.lng ?? null,
    metadata: { site_id: site.orgId, site_slug: site.slug, campaign_id: campaignId ?? undefined, timezone: geo?.timezone, ...(metadata ?? {}) }
  }
}

export function forwardInBackground(event: H3Event, site: SiteRef, e: ForwardInput): void {
  background(event, build(event, site, e).then(forwardEvent))
}

export async function forwardNow(event: H3Event, site: SiteRef, e: ForwardInput): Promise<string | null> {
  return await forwardEvent(await build(event, site, e))
}
