// Landing page sections, in their fixed order. The list and defaults live in
// code; a site stores only its content, the sections it hid and its custom
// sections. Sections with nothing to show hide themselves.
import type { Tx } from './db/scope'
import { campaignSeries } from './campaigns'
import { getTemplate } from './setup'

export const LANDING_SECTIONS = ['top', 'why', 'custom', 'stories', 'how', 'signup', 'today', 'share', 'contact', 'app'] as const
export type LandingSection = typeof LANDING_SECTIONS[number]

// Sections a champion may hide. The top section always shows.
export const HIDEABLE_SECTIONS: readonly LandingSection[] = ['why', 'custom', 'stories', 'how', 'today', 'share', 'contact', 'app']

export function visibleSections(hidden: string[] | undefined, templateKey: string | null | undefined, opts: { hasStories: boolean, hasCustom: boolean, hasWhy: boolean, appAvailable: boolean }): LandingSection[] {
  const hiddenSet = new Set(hidden ?? getTemplate(templateKey).hiddenSections)
  return LANDING_SECTIONS.filter((s) => {
    if (s === 'top' || s === 'signup') return true
    if (hiddenSet.has(s)) return false
    if (s === 'why') return opts.hasWhy
    if (s === 'custom') return opts.hasCustom
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
