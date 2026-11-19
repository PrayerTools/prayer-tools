// WordPress `campaigns` posts → v3 campaign rows (setup answers, images and
// colour) for one site. Landing and email texts are in landing.ts.
import type { Cadence, CampaignBranding, Goal } from '@prayertools/shared/db/schema'
import { addDays, todayIn, zonedInstant } from '@prayertools/shared/dates'
import { campaignSlugError } from '@prayertools/shared/paths'
import { SLOT_OPTIONS } from '@prayertools/shared/setup'
import type { SQL } from 'bun'
import { first, languageOf, networkTable, table, tableExists, wpDate, type Meta, type WpPost } from './wp'

export interface CampaignPlan {
  wpId: number
  slug: string
  name: string
  templateKey: string
  kind: 'side' | null
  startDate: string
  endDate: string | null
  goal: Goal
  goalTarget: number | null
  slotMin: number | null
  cadence: Cadence
  timezone: string
  languages: string[]
  defaultLanguage: string | null
  branding: CampaignBranding
  color: string | null
  publishedAt: Date
  endedAt: Date | null
  warnings: string[]
  // An open-ended campaign overlapping this earlier main campaign (its WordPress id).
  overlaps?: number
}

export interface Place { name: string, latitude: number | null, longitude: number | null }

// A campaign's location: the labels of its own location entries, else the
// names of its location grid ids.
export async function placesOf(wp: SQL, blogId: number, meta: Map<number, Meta>): Promise<Map<number, Place>> {
  const out = new Map<number, Place>()
  const hasMeta = await tableExists(wp, table(blogId, 'dt_location_grid_meta'))
  for (const [postId, m] of meta) {
    const metaIds = (m.get('location_grid_meta') ?? []).map(Number).filter(Boolean)
    const gridIds = (m.get('location_grid') ?? []).map(Number).filter(Boolean)
    let rows: { label: string, lat: number | null, lng: number | null }[] = []
    if (metaIds.length && hasMeta) {
      rows = await wp.unsafe(`SELECT label, lat, lng FROM ${table(blogId, 'dt_location_grid_meta')} WHERE grid_meta_id IN (${metaIds.map(() => '?').join(',')})`, metaIds) as typeof rows
    }
    if (!rows.length && gridIds.length) {
      rows = await wp.unsafe(`SELECT name label, latitude lat, longitude lng FROM ${networkTable('location_grid')} WHERE grid_id IN (${gridIds.map(() => '?').join(',')})`, gridIds) as typeof rows
    }
    const labels = [...new Set(rows.map(r => r.label?.trim()).filter(Boolean))]
    if (!labels.length) continue
    out.set(postId, { name: labels.join(', ').slice(0, 200), latitude: rows.length === 1 && rows[0]!.lat !== null ? Number(rows[0]!.lat) : null, longitude: rows.length === 1 && rows[0]!.lng !== null ? Number(rows[0]!.lng) : null })
  }
  return out
}

// An image the prayer campaigns plugin ships (its default header), which no champion chose.
export function isPluginDefault(url: string): boolean {
  return /\/wp-content\/plugins\/disciple-tools-prayer-campaigns\//.test(url)
}

const isoUtc = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10)

export function validTimezone(tz: string | null | undefined): string | null {
  if (!tz) return null
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return tz
  } catch {
    return null
  }
}

function campaignSlug(raw: string | null, taken: Set<string>, fallback: string): string {
  let slug = (raw ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  if (!slug || campaignSlugError(slug)) slug = fallback
  let candidate = slug
  for (let n = 2; taken.has(candidate) || campaignSlugError(candidate); n++) candidate = `${slug.slice(0, 36)}-${n}`
  taken.add(candidate)
  return candidate
}

export function planCampaigns(posts: WpPost[], meta: Map<number, Meta>, now = new Date()): CampaignPlan[] {
  const taken = new Set<string>()
  const plans = posts.map((p, i): CampaignPlan => {
    const m = meta.get(p.ID)
    const warnings: string[] = []
    const timezone = validTimezone(first(m, 'campaign_timezone')) ?? 'UTC'
    const startTs = Number(first(m, 'start_date')) || 0
    const endTs = Number(first(m, 'end_date')) || 0
    const fuel = first(m, 'prayer_fuel_frequency')
    const cadence: Cadence = fuel === 'weekly' || fuel === 'monthly' ? fuel : 'daily'
    let startDate = startTs ? isoUtc(startTs) : wpDate(p.post_date_gmt).toISOString().slice(0, 10)
    // Monthly entries are calendar months, so a monthly campaign starts on the 1st.
    if (cadence === 'monthly' && !startDate.endsWith('-01')) {
      warnings.push(`monthly campaign starting ${startDate} starts on the 1st of that month`)
      startDate = `${startDate.slice(0, 8)}01`
    }
    let endDate = endTs ? isoUtc(endTs) : null
    if (endDate && endDate < startDate) {
      warnings.push(`end date ${endDate} before start ${startDate}; ends on its start date`)
      endDate = startDate
    }
    const wpGoal = first(m, 'campaign_goal')
    const hours = Number(first(m, 'goal_quantity')) || 24
    // Monthly campaigns have no 24/7 grid; they aim for prayer time.
    const goal: Goal = endDate && wpGoal !== 'quantity' && cadence !== 'monthly' ? 'coverage' : 'prayer_time'
    const minTime = Number(first(m, 'min_time_duration')) || 15
    const slotMin = goal === 'coverage' ? ((SLOT_OPTIONS as readonly number[]).includes(minTime) ? minTime : 15) : null
    if (goal === 'coverage' && slotMin !== minTime) warnings.push(`slot length ${minTime} min not offered; uses 15`)
    const languages = [...new Set((m?.get('enabled_languages') ?? []).map(languageOf))]
    const defaultLocale = first(m, 'default_language')
    const defaultLanguage = defaultLocale ? languageOf(defaultLocale) : null
    const image = (key: string) => {
      const url = first(m, key)?.trim()
      return url && !isPluginDefault(url) ? url : null
    }
    const hero = image('header_background_url')
    const share = image('promo_image_url')
    const branding: CampaignBranding = { ...(hero ? { image_url: hero } : {}), ...(share ? { share_image_url: share } : {}) }
    const custom = first(m, 'custom_theme_color')

    // Ended campaigns carry ended_at, so the end-date sweep doesn't treat
    // them as ending now and send their thank-you.
    const lastModified = Number(first(m, 'last_modified')) || 0
    const inactive = first(m, 'status') === 'inactive'
    let endedAt: Date | null = null
    if (endDate && endDate < todayIn(timezone, now)) endedAt = zonedInstant(addDays(endDate, 1), '00:00', timezone)
    else if (inactive) endedAt = lastModified ? new Date(lastModified * 1000) : wpDate(p.post_modified_gmt)

    return {
      wpId: p.ID,
      slug: campaignSlug(first(m, 'campaign_url'), taken, `campaign-${i + 1}`),
      name: p.post_title.trim() || `Campaign ${i + 1}`,
      templateKey: first(m, 'porch_type') === 'ramadan-porch' ? 'ramadan' : 'generic',
      kind: null,
      startDate,
      endDate,
      goal,
      goalTarget: goal === 'prayer_time' ? hours * 60 : null,
      slotMin,
      cadence,
      timezone,
      languages,
      defaultLanguage,
      branding,
      color: custom && /^#[0-9a-f]{6}$/i.test(custom) ? custom.toLowerCase() : null,
      publishedAt: wpDate(p.post_date_gmt),
      endedAt,
      warnings
    }
  })

  // Main campaigns don't overlap: a dated campaign overlapping an earlier
  // main one becomes a side campaign.
  const mains: CampaignPlan[] = []
  const end = (c: CampaignPlan) => c.endDate ?? (c.endedAt ? c.endedAt.toISOString().slice(0, 10) : '9999-12-31')
  for (const c of [...plans].sort((a, b) => a.startDate.localeCompare(b.startDate))) {
    const overlap = mains.find(o => o.startDate <= end(c) && c.startDate <= end(o))
    if (!overlap) mains.push(c)
    else if (c.endDate) c.kind = 'side'
    else {
      c.warnings.push(`open-ended and overlaps ${overlap.slug}; kept as a main campaign`)
      c.overlaps = overlap.wpId
      mains.push(c)
    }
  }
  return plans
}

// Subscribers and published prayer fuel posts per campaign.
export async function campaignUse(wp: SQL, blogId: number): Promise<Map<number, { subscribers: number, fuel: number }>> {
  const out = new Map<number, { subscribers: number, fuel: number }>()
  const get = (id: number) => out.get(id) ?? (out.set(id, { subscribers: 0, fuel: 0 }), out.get(id)!)
  const subs = await tableExists(wp, table(blogId, 'p2p'))
    ? await wp.unsafe(`SELECT p2p_from id, count(*) n FROM ${table(blogId, 'p2p')} WHERE p2p_type = 'campaigns_to_subscriptions' GROUP BY p2p_from`) as { id: number, n: number }[]
    : []
  for (const r of subs) get(Number(r.id)).subscribers = Number(r.n)
  const fuel = await wp.unsafe(
    `SELECT m.meta_value id, count(*) n FROM ${table(blogId, 'postmeta')} m JOIN ${table(blogId, 'posts')} p ON p.ID = m.post_id
     WHERE m.meta_key = 'linked_campaign' AND p.post_type = 'landing' AND p.post_status IN ('publish', 'future') GROUP BY m.meta_value`
  ) as { id: string, n: number }[]
  for (const r of fuel) get(Number(r.id)).fuel = Number(r.n)
  return out
}

// Campaigns overlapping an open-ended one that nobody signed up for and that
// have no prayer content aren't imported; they'd only compete to be the site's
// home campaign. When all of them are empty, the one WordPress showed on the
// home page (`selected`) stays.
export function emptyOverlaps(plans: CampaignPlan[], use: Map<number, { subscribers: number, fuel: number }>, selected: number): Set<number> {
  const groups = new Map<number, Set<number>>()
  for (const p of plans) {
    if (!p.overlaps) continue
    const root = [...groups].find(([, g]) => g.has(p.overlaps!) || g.has(p.wpId))?.[0] ?? p.overlaps
    groups.set(root, new Set([...(groups.get(root) ?? []), p.overlaps, p.wpId]))
  }
  const empty = (id: number) => !use.get(id)?.subscribers && !use.get(id)?.fuel
  const drop = new Set<number>()
  for (const group of groups.values()) {
    const ids = [...group]
    const keep = ids.every(empty) ? (ids.includes(selected) ? selected : Math.max(...ids)) : null
    for (const id of ids) if (empty(id) && id !== keep) drop.add(id)
  }
  return drop
}

// The site's people groups. WordPress keeps them as records on the site, not
// linked to a campaign: their names (without "(Country | id)"), as one list.
export async function peopleGroupsOf(wp: SQL, blogId: number): Promise<string | null> {
  const rows = await wp.unsafe(`SELECT post_title FROM ${table(blogId, 'posts')} WHERE post_type = 'peoplegroups' AND post_status = 'publish' ORDER BY ID`) as { post_title: string }[]
  const names = [...new Set(rows.map(r => r.post_title.normalize('NFC').replace(/\s+/g, ' ').replace(/\s*\([^()]*\|[^()]*\)\s*$/, '').trim()).filter(n => n && n !== 'Auto Draft'))]
  // Names like "Swahili, Pemba" have commas of their own.
  return names.length ? names.join(names.some(n => n.includes(',')) ? '; ' : ', ').slice(0, 500) : null
}
