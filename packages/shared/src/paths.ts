// Public site URL shape: `/{lang?}/{campaign?}/{page}/{…}`. The language
// segment is one of the site's languages; the campaign segment addresses a
// past or future campaign (`/2025/stats`) or a side campaign
// (`/ramadan-2027`); with neither, the site's current campaign in its default
// language is shown.
import { isLanguage } from './languages'

export const SITE_PAGES = [
  'pray', 'stats', 'signup', 'contact', 'stories', 'story', 'share', 'manage', 'calendar', 'coverage', 'embed',
  'm', 'u', 'verify', 'checkin', 'ics', 'preview', 'joined', 'notify', 'api', '_nuxt', 'subscriptions_app', 'prayer', 'notice', 'fuel'
] as const

export function campaignSlugError(slug: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) return 'invalid'
  if ((SITE_PAGES as readonly string[]).includes(slug) || isLanguage(slug)) return 'reserved'
  return null
}

export interface ParsedSitePath {
  lang: string | null
  campaignSlug: string | null
  page: string
  rest: string[]
}

export function parseSitePath(path: string, siteLanguages: string[], campaignSlugs: string[]): ParsedSitePath {
  const segs = path.split('?')[0]!.split('/').filter(Boolean).map(s => decodeURIComponent(s))
  let lang: string | null = null
  let campaignSlug: string | null = null
  if (segs[0] && siteLanguages.includes(segs[0])) lang = segs.shift()!
  if (segs[0] && campaignSlugs.includes(segs[0])) campaignSlug = segs.shift()!
  const page = segs.shift() ?? ''
  return { lang, campaignSlug, page, rest: segs }
}

export function sitePath(opts: { lang?: string | null, defaultLang?: string, campaignSlug?: string | null, page?: string, rest?: (string | number)[] }): string {
  const parts: string[] = []
  if (opts.lang && opts.lang !== opts.defaultLang) parts.push(opts.lang)
  if (opts.campaignSlug) parts.push(opts.campaignSlug)
  if (opts.page) parts.push(opts.page)
  for (const r of opts.rest ?? []) parts.push(String(r))
  return `/${parts.join('/')}`
}
