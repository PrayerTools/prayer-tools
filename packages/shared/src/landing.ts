// Landing page sections and the order they show in. The list, the default
// order and other defaults live in code; a site stores only its content, the
// sections it hid, its custom sections and an order of its own. Sections with
// nothing to show hide themselves.
import type { Tx } from './db/scope'
import { campaignSeries } from './campaigns'
import { getTemplate } from './setup'

// `top` is always first. `custom` is where custom sections sit by default.
export const LANDING_SECTIONS = ['top', 'why', 'custom', 'stories', 'how', 'signup', 'today', 'share', 'contact', 'app'] as const
export type LandingSection = typeof LANDING_SECTIONS[number]

// Sections a champion may hide. The top section and the signup form always
// show. `custom` hides every custom section; `custom:<id>` hides one.
export const HIDEABLE_SECTIONS: readonly LandingSection[] = ['why', 'custom', 'stories', 'how', 'today', 'share', 'contact', 'app']

const CUSTOM_PREFIX = 'custom:'

// One custom section's entry in `order` and `hidden`.
export function customSectionKey(id: string): string {
  return `${CUSTOM_PREFIX}${id}`
}

export function customSectionId(key: string): string | null {
  return key.startsWith(CUSTOM_PREFIX) ? key.slice(CUSTOM_PREFIX.length) : null
}

export function defaultLandingOrder(customIds: readonly string[]): string[] {
  return [...new Set(LANDING_SECTIONS.flatMap(s => s === 'top' ? [] : s === 'custom' ? customIds.map(customSectionKey) : [s]))]
}

// The sections after the top one, in the order the page shows them. Stored
// entries that match no section are dropped, and a section the stored order
// leaves out goes right after the sections that precede it by default.
export function landingOrder(stored: readonly string[] | null | undefined, customIds: readonly string[]): string[] {
  const defaults = defaultLandingOrder(customIds)
  if (!Array.isArray(stored)) return defaults
  const known = new Set(defaults)
  const order = [...new Set(stored.filter(key => known.has(key)))]
  defaults.forEach((key, i) => {
    if (order.includes(key)) return
    const after = Math.max(-1, ...defaults.slice(0, i).map(before => order.indexOf(before)))
    order.splice(after + 1, 0, key)
  })
  return order
}

// The order to store: none while it matches the default order.
export function storedLandingOrder(order: unknown, customIds: readonly string[]): string[] | undefined {
  if (!Array.isArray(order)) return undefined
  const resolved = landingOrder(order, customIds)
  return resolved.join('\n') === defaultLandingOrder(customIds).join('\n') ? undefined : resolved
}

export function isHideableSection(key: string, customIds: readonly string[]): boolean {
  const id = customSectionId(key)
  return id === null ? (HIDEABLE_SECTIONS as readonly string[]).includes(key) : customIds.includes(id)
}

export function isSectionHidden(hidden: readonly string[], key: string): boolean {
  return hidden.includes(key) || (customSectionId(key) !== null && hidden.includes('custom'))
}

// `hidden` with the entry for every custom section replaced by one entry per section.
export function expandHiddenCustom(hidden: readonly string[], customIds: readonly string[]): string[] {
  if (!hidden.includes('custom')) return [...hidden]
  return [...new Set([...hidden.filter(key => key !== 'custom'), ...customIds.map(customSectionKey)])]
}

// The sections that show after the top one, in order: standard section keys
// and `custom:<id>` entries.
export function visibleSections(
  landing: { hidden?: string[], order?: string[], custom?: { id: string }[] },
  templateKey: string | null | undefined,
  opts: { hasStories: boolean, hasWhy: boolean, appAvailable: boolean, hasCustom: (id: string) => boolean }
): string[] {
  const hidden = landing.hidden ?? getTemplate(templateKey).hiddenSections
  return landingOrder(landing.order, (landing.custom ?? []).map(c => c.id)).filter((s) => {
    if (s === 'signup') return true
    if (isSectionHidden(hidden, s)) return false
    const id = customSectionId(s)
    if (id !== null) return opts.hasCustom(id)
    if (s === 'why') return opts.hasWhy
    if (s === 'stories') return opts.hasStories
    if (s === 'app') return opts.appAvailable
    return true
  })
}

export const LANDING_STORY_LIMIT = 6

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// A side campaign's chosen stories (`landing.story_ids`), or undefined when it has not chosen.
export function parseStoryIds(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined
  return [...new Set(input.filter((v): v is string => typeof v === 'string' && UUID_RE.test(v)))].slice(0, LANDING_STORY_LIMIT)
}

// The stories on a landing page, newest first. The main campaign shows every published
// story on the site. A side campaign shows the stories it chose from anywhere on the site,
// or, until it chooses, the published stories from its series.
export async function landingStories(tx: Tx, side: { campaignId: string, storyIds?: string[] } | null = null) {
  let q = tx
    .selectFrom('pt_story')
    .select(['id', 'body', 'name', 'use_name'])
    .where('may_publish', '=', true)
  if (side?.storyIds) {
    if (!side.storyIds.length) return []
    return await q.where('id', 'in', side.storyIds).orderBy('created_at', 'desc').limit(LANDING_STORY_LIMIT).execute()
  }
  q = q.where('published', '=', true)
  if (side) {
    const ids = (await campaignSeries(tx, side.campaignId, { drafts: true })).map(c => c.id)
    if (!ids.length) return []
    q = q.where('campaign_id', 'in', ids)
  }
  return await q.orderBy('published_at', 'desc').limit(LANDING_STORY_LIMIT).execute()
}
