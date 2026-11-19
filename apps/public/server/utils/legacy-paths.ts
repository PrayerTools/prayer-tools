// WordPress-era site addresses and where they now live. Its campaign pages
// were `/{campaign}/{page}` with pages `fuel`, `list`, `listEdit` and
// `contact-us`, personal fuel links were `/prayer/fuel/<key>`, and
// `?lang=<locale>` chose the language.
import { pickLanguage } from '@prayertools/shared/languages'
import { sitePath } from '@prayertools/shared/paths'

const PAGES: Record<string, string> = { 'list': 'pray', 'listedit': 'pray', 'contact-us': 'contact' }

export interface LegacySite {
  languages: string[]
  defaultLanguage: string
  campaignSlugs: string[]
}

export type LegacyTarget =
  | { kind: 'redirect', to: string }
  // A personal fuel key: `base` is the pray page to open with the person's link.
  | { kind: 'fuel_key', key: string, base: string }

export function isLegacyPath(segments: string[], query: URLSearchParams): boolean {
  return segments[0] !== 'api' && (segments.includes('fuel') || segments.some(s => s.toLowerCase() in PAGES) || query.has('lang'))
}

export function legacyTarget(segments: string[], query: URLSearchParams, site: LegacySite): LegacyTarget | null {
  const wanted = query.get('lang')
  const queryLang = wanted ? pickLanguage(wanted, site.languages, '') || null : null
  const params = new URLSearchParams(query)
  params.delete('lang')
  const search = params.size ? `?${params}` : ''

  // The language and campaign segments in front of the old page name.
  const prefix = (end: number) => {
    const before = segments.slice(0, end)
    return {
      lang: before.find(s => site.languages.includes(s)) ?? queryLang,
      campaignSlug: before.find(s => site.campaignSlugs.includes(s)) ?? null
    }
  }
  const at = (end: number, page: string, rest: (string | number)[] = []) =>
    sitePath({ ...prefix(end), defaultLang: site.defaultLanguage, page, rest })

  const fuel = segments.indexOf('fuel')
  if (fuel >= 0) {
    const after = segments[fuel + 1] ?? ''
    if (/^\d{1,4}$/.test(after)) return { kind: 'redirect', to: at(fuel, 'pray', [Number(after)]) + search }
    if (after) return { kind: 'fuel_key', key: after, base: at(fuel, 'pray') }
    return { kind: 'redirect', to: at(fuel, 'pray') + search }
  }

  const page = segments.findIndex(s => s.toLowerCase() in PAGES)
  const onlyPrefix = (end: number) => segments.slice(0, end).every(s => site.languages.includes(s) || site.campaignSlugs.includes(s))
  if (page >= 0 && onlyPrefix(page)) return { kind: 'redirect', to: at(page, PAGES[segments[page]!.toLowerCase()]!) + search }

  // Only `?lang`: the same page under its language prefix.
  const hasLangSegment = !!segments[0] && site.languages.includes(segments[0])
  if (queryLang && !hasLangSegment && queryLang !== site.defaultLanguage) {
    return { kind: 'redirect', to: `/${[queryLang, ...segments].map(encodeURIComponent).join('/')}${search}` }
  }
  return null
}
