import type { Tx } from '@prayertools/shared/db/scope'
import type { TiptapDoc } from '@prayertools/shared/db/schema'
import { contentLength, dayContent, placeholderVars } from '@prayertools/shared/content'
import { tiptapToHtml } from '@prayertools/shared/tiptap'
import type { CampaignRow } from '@prayertools/shared/subscriptions'
import type { ContentBlockView } from '../../shared/view'
import type { SiteData } from './site-data'

export function formatDate(date: string | null, lang: string): string {
  if (!date) return ''
  try {
    return new Intl.DateTimeFormat(lang, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
  } catch {
    return date
  }
}

export function contentVars(data: SiteData, siteName: string, c: CampaignRow, lang: string): Record<string, string> {
  return placeholderVars({
    siteName,
    campaignName: c.name,
    lang,
    place: c.place_name,
    placeWording: c.place_wording,
    peopleGroup: c.people_group,
    startDate: formatDate(c.start_date, lang),
    endDate: formatDate(c.end_date, lang)
  })
}

export async function contentBlocks(tx: Tx, data: SiteData, siteName: string, c: CampaignRow, day: number, lang: string, maxNodes?: number): Promise<ContentBlockView[]> {
  const vars = contentVars(data, siteName, c, lang)
  const blocks = await dayContent(tx, c.id, day, lang, data.site.default_language)
  return blocks.map((b) => {
    const doc: TiptapDoc = maxNodes ? { type: 'doc', content: (b.doc.content ?? []).slice(0, maxNodes) } : b.doc
    return { title: b.title, html: tiptapToHtml(doc, { mode: 'web', vars }), credit: b.credit, license: b.license }
  })
}

// The last entry number content exists for, bounded by the campaign length.
export async function lastEntry(tx: Tx, c: CampaignRow, length: number | null): Promise<number> {
  const n = await contentLength(tx, c.id)
  return length ? Math.min(length, Math.max(n, 0)) || length : n
}

export function docHtml(docs: Record<string, TiptapDoc> | undefined, lang: string, fallback: string, vars?: Record<string, string>): string {
  const doc = docs?.[lang] ?? docs?.[fallback] ?? Object.values(docs ?? {})[0]
  return doc ? tiptapToHtml(doc, { mode: 'web', vars }) : ''
}
