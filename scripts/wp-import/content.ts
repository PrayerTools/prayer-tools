// WordPress prayer fuel (`landing` posts) → one site library per campaign
// with an entry per day and language, plus the campaign images the site's
// own server holds. Follows what WordPress shows: published or scheduled
// posts with a campaign and a day; a post without a language is English; a
// day with several posts shows all of them, newest first.
import type { SQL } from 'bun'
import type { Tx } from '@prayertools/shared/db/scope'
import type { CampaignBranding, TiptapDoc, TiptapNode } from '@prayertools/shared/db/schema'
import { jsonb } from '@prayertools/shared/db/json'
import { campaignLength } from '@prayertools/shared/setup'
import type { CampaignRow } from '@prayertools/shared/subscriptions'
import { first, languageOf, metaOf, postsOf, wpDate, type WpPost } from './wp'
import { htmlToDoc } from './fuel'

export interface ContentImages {
  rewrite(doc: TiptapDoc): Promise<TiptapDoc>
  // The stored copy, the URL itself when on another host, or null to drop it.
  rewriteUrl(url: string): Promise<string | null>
}

export interface ContentCounts {
  posts: number
  entries: number
  drafts: number
  noCampaignOrDay: number
  campaignDeleted: number
  combinedPosts: number
  identicalDropped: number
  languages: Record<string, number>
  // Entries numbered past their campaign's last day: imported, but v3 doesn't show them.
  pastEnd: { campaign: string, days: number[] }[]
}

interface DayPost { post: WpPost, campaign: CampaignRow, day: number, language: string }

export async function importContent(wp: SQL, blogId: number, tx: Tx, input: {
  campaigns: Map<number, CampaignRow>
  images: ContentImages
  unknown: Map<string, number>
}): Promise<ContentCounts> {
  const counts: ContentCounts = { posts: 0, entries: 0, drafts: 0, noCampaignOrDay: 0, campaignDeleted: 0, combinedPosts: 0, identicalDropped: 0, languages: {}, pastEnd: [] }

  for (const [wpId, c] of input.campaigns) {
    const b = c.branding as CampaignBranding
    const branding: CampaignBranding = { ...b }
    for (const key of ['image_url', 'share_image_url'] as const) {
      if (!b[key]) continue
      const url = await input.images.rewriteUrl(b[key]!)
      if (url) branding[key] = url
      else delete branding[key]
    }
    if (JSON.stringify(branding) !== JSON.stringify(b)) {
      await tx.updateTable('pt_campaign').set({ branding: jsonb(branding) }).where('id', '=', c.id).execute()
      input.campaigns.set(wpId, { ...c, branding })
    }
  }

  const posts = await postsOf(wp, blogId, 'landing')
  if (!posts.length) return counts
  const meta = await metaOf(wp, blogId, posts.map(p => p.ID))
  const blocks = new Map((await postsOf(wp, blogId, 'wp_block')).map(b => [b.ID, b.post_content]))
  const days = new Map<string, DayPost[]>()
  for (const p of posts) {
    counts.posts++
    if (p.post_status !== 'publish' && p.post_status !== 'future') { counts.drafts++; continue }
    const m = meta.get(p.ID)
    const linked = Number(first(m, 'linked_campaign')) || 0
    const day = Number(first(m, 'day')) || 0
    if (!linked || day < 1) { counts.noCampaignOrDay++; continue }
    const campaign = input.campaigns.get(linked)
    if (!campaign) { counts.campaignDeleted++; continue }
    const language = languageOf(first(m, 'post_language') ?? 'en_US')
    const key = `${campaign.id}|${day}|${language}`
    days.set(key, [...(days.get(key) ?? []), { post: p, campaign, day, language }])
  }

  const entries: { campaignId: string, day: number, language: string, doc: TiptapDoc, modified: number }[] = []
  for (const group of days.values()) {
    group.sort((a, b) => wpDate(b.post.post_date_gmt).getTime() - wpDate(a.post.post_date_gmt).getTime())
    const seen = new Set<string>()
    const parts: TiptapNode[][] = []
    for (const { post } of group) {
      const fingerprint = `${post.post_title.trim()}\n${post.post_content.trim()}`
      if (seen.has(fingerprint)) { counts.identicalDropped++; continue }
      seen.add(fingerprint)
      const converted = htmlToDoc(post.post_content, { reusableBlock: ref => blocks.get(ref) })
      for (const kind of converted.unknown) input.unknown.set(kind, (input.unknown.get(kind) ?? 0) + 1)
      const title = post.post_title.replace(/\s+/g, ' ').trim()
      parts.push([
        ...(title ? [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: title }] }] : []),
        ...(converted.doc.content ?? [])
      ])
    }
    if (parts.length > 1) counts.combinedPosts += parts.length - 1
    const doc: TiptapDoc = { type: 'doc', content: parts.flatMap((p, i) => i ? [{ type: 'horizontalRule' }, ...p] : p) }
    const { campaign, day, language } = group[0]!
    const modified = Math.max(...group.map(g => wpDate(g.post.post_modified_gmt).getTime()))
    entries.push({ campaignId: campaign.id, day, language, doc: await input.images.rewrite(doc), modified })
  }

  for (const c of input.campaigns.values()) {
    const own = entries.filter(e => e.campaignId === c.id)
    if (!own.length) continue
    const lib = await tx.insertInto('pt_site_library').values({ library_id: null, title: c.name, cadence: c.cadence }).returning('id').executeTakeFirstOrThrow()
    for (let i = 0; i < own.length; i += 200) {
      await tx.insertInto('pt_site_entry').values(own.slice(i, i + 200).map(e => ({
        site_library_id: lib.id, day: e.day, language: e.language, content: jsonb(e.doc), edited: true, updated_at: new Date(e.modified)
      }))).execute()
    }
    await tx.insertInto('pt_campaign_library').values({ campaign_id: c.id, site_library_id: lib.id, position: 0 }).execute()
    counts.entries += own.length
    for (const e of own) counts.languages[e.language] = (counts.languages[e.language] ?? 0) + 1
    const length = campaignLength(c as never)
    const past = length === null ? [] : [...new Set(own.filter(e => e.day > length).map(e => e.day))].sort((a, b) => a - b)
    if (past.length) counts.pastEnd.push({ campaign: c.slug, days: past })
  }
  return counts
}
