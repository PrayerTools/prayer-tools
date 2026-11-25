// WordPress landing page and email texts → v3 campaign landing, email text
// and place, and the site's strings and email identity. WordPress keeps each
// text in the campaign's own language on the campaign, and its other
// languages in `dt_translations`.
import type { SQL } from 'bun'
import type { CampaignEmailText, CampaignLanding, LandingCustomSection, TiptapDoc, TiptapNode, TranslatableText } from '@prayertools/shared/db/schema'
import { customSectionKey, defaultLandingOrder } from '@prayertools/shared/landing'
import { isTemplateDoc } from '@prayertools/shared/i18n/landing'
import { visionTexts } from './vision'
import { videoEmbed } from '@prayertools/shared/video'
import { normalizeEmail } from '@prayertools/shared/crm'
import { first, languageOf, table, tableExists, unserialize, type Meta } from './wp'
import { htmlToDoc } from './fuel'
import { isPluginDefault } from './campaigns'

// campaign post id → field key → language → text
export type Translations = Map<number, Map<string, Map<string, string>>>

export async function translationsOf(wp: SQL, blogId: number): Promise<Translations> {
  const out: Translations = new Map()
  if (!await tableExists(wp, table(blogId, 'dt_translations'))) return out
  const rows = await wp.unsafe(`SELECT post_id, \`key\` k, language, value FROM ${table(blogId, 'dt_translations')} WHERE value <> ''`) as { post_id: number, k: string, language: string, value: string }[]
  for (const r of rows) {
    const byKey = out.get(Number(r.post_id)) ?? new Map<string, Map<string, string>>()
    const byLang = byKey.get(r.k) ?? new Map<string, string>()
    byLang.set(languageOf(r.language), r.value)
    byKey.set(r.k, byLang)
    out.set(Number(r.post_id), byKey)
  }
  return out
}

// The plugin's English defaults for section titles: a title equal to its default wasn't written by the champion.
const DEFAULTS: Record<string, string> = {
  vision_title: 'Our Vision',
  prayer_fuel_title: 'Prayer Fuel'
}
const COLUMNS = ['pray', 'movement', 'time'] as const

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
const plain = (html: string) => norm(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, '\'').replace(/&quot;/g, '"'))

const columnTitle = (text: string): TiptapNode => ({ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text }] })

// A YouTube or Vimeo player, or a link to any other video.
function videoNodes(url: string): TiptapNode[] {
  const v = videoEmbed(url)
  if (!v) return []
  if (v.kind !== 'file') return [{ type: 'youtube', attrs: { src: url } }]
  return [{ type: 'paragraph', content: [{ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }] }]
}

export interface LandingInput {
  defaultLanguage: string
  languages: string[]
  ramadan: boolean
  campaignName: string
  rewrite(doc: TiptapDoc): Promise<TiptapDoc>
  // The stored copy, the URL itself when on another host, or null to drop it.
  rewriteUrl(url: string): Promise<string | null>
  // The stored address of the plugin's own icon for a vision column, shipped with the importer in neutral grey.
  defaultIcon(column: typeof COLUMNS[number]): Promise<string | null>
}

export interface LandingText {
  description: TranslatableText | null
  landing: CampaignLanding
  emailText: CampaignEmailText
  placeName: string | null
  peopleGroup: string | null
  // Site-wide, taken from the site's latest main campaign.
  siteStrings: { key: string, language: string, value: string }[]
  emailIdentity: { from_name?: string, reply_to?: string, logo_url?: string, signature?: TranslatableText }
  siteLogoUrl: string | null
}

export async function landingText(meta: Meta | undefined, tr: Map<string, Map<string, string>> | undefined, input: LandingInput): Promise<LandingText> {
  const def = input.defaultLanguage
  // A field per language: the campaign's own value in its language, translations for the others.
  const field = (key: string): Record<string, string> => {
    const out: Record<string, string> = {}
    const base = first(meta, key)?.trim()
    if (base) out[def] = base
    for (const [lang, v] of tr?.get(key) ?? []) if (input.languages.includes(lang) && v.trim()) out[lang] = v.trim()
    return out
  }
  const changed = (key: string, values: Record<string, string>) => Object.values(values).some(v => !DEFAULTS[key] || norm(plain(v)) !== norm(DEFAULTS[key]!))
  const text = (values: Record<string, string>): TranslatableText | null => {
    const entries = Object.entries(values).map(([l, v]) => [l, plain(v)] as const).filter(([, v]) => v)
    if (!entries.length) return null
    return { source: entries.some(([l]) => l === def) ? def : entries[0]![0], values: Object.fromEntries(entries), stale: [] }
  }
  const doc = async (html: string): Promise<TiptapNode[]> => (await input.rewrite(htmlToDoc(html).doc)).content ?? []
  const docs = async (values: Record<string, string>): Promise<Record<string, TiptapDoc>> => {
    const out: Record<string, TiptapDoc> = {}
    for (const [lang, html] of Object.entries(values)) {
      const content = await doc(html)
      if (content.length) out[lang] = { type: 'doc', content }
    }
    return out
  }

  const subtitle = text(field('subtitle'))

  // "Why we pray" is the vision as WordPress showed it in each language, its three
  // columns side by side, then the video. The vision is imported when the champion
  // changed it or a column, the columns only when they changed a column; the video
  // alone is kept when they changed neither.
  const daily = first(meta, 'campaign_goal') === 'quantity'
  const defaultsIn = (lang: string) => visionTexts(lang, daily) ?? visionTexts('en', daily)!
  const vision = field('vision')
  const columns = COLUMNS.map(c => [field(`${c}_section_title`), field(`${c}_section_text`)] as const)
  const own = (values: Record<string, string>, pick: (d: ReturnType<typeof defaultsIn>) => string) =>
    Object.entries(values).some(([lang, v]) => norm(plain(v)) !== norm(pick(defaultsIn(lang))))
  // A column's icon: the champion's own, else the plugin's.
  const ownIcons = COLUMNS.map(c => {
    const url = first(meta, `${c}_section_icon`)?.trim()
    return url && /^https?:\/\//.test(url) && !isPluginDefault(url) ? url : null
  })
  const ownColumns = ownIcons.some(Boolean)
    || columns.some(([title, body], i) => own(title, d => d.columns[i]![0]) || own(body, d => d.columns[i]![1]))
  const ownVision = ownColumns || own(vision, d => d.vision)
  const icons = ownColumns ? await Promise.all(COLUMNS.map(async (c, i) => (ownIcons[i] ? await input.rewriteUrl(ownIcons[i]) : null) ?? await input.defaultIcon(c))) : []
  const shown = (values: Record<string, string>, lang: string, fallback: string) => values[lang] ?? values[def] ?? fallback
  const video = first(meta, 'promo_video_url')?.trim()
  const videoContent = video ? videoNodes(video) : []
  const why: Record<string, TiptapDoc> = {}
  for (const lang of ownVision || videoContent.length ? input.languages : []) {
    const content: TiptapNode[] = []
    const defaults = defaultsIn(lang)
    if (ownVision) content.push(...await doc(shown(vision, lang, defaults.vision)))
    if (ownColumns) {
      const cols: TiptapNode[] = []
      for (const [i, [title, body]] of columns.entries()) {
        const icon: TiptapNode[] = icons[i] ? [{ type: 'imageResize', attrs: { src: icons[i], alt: '', width: 40 } }] : []
        cols.push({ type: 'column', content: [...icon, columnTitle(plain(shown(title, lang, defaults.columns[i]![0]))), ...await doc(shown(body, lang, defaults.columns[i]![1]))] })
      }
      content.push({ type: 'columns', content: cols })
    }
    why[lang] = { type: 'doc', content: [...content, ...videoContent] }
  }

  // Custom sections need a heading: a section's own first heading, else a name for it.
  const nameHeading = (): TranslatableText => ({ source: def, values: { [def]: input.campaignName }, stale: [] })
  const section = async (id: string, values: Record<string, string>, fixed: TranslatableText | null): Promise<LandingCustomSection | null> => {
    const body = await docs(values)
    if (!Object.keys(body).length) return null
    let heading = fixed
    if (!heading) {
      const own: Record<string, string> = {}
      for (const [lang, d] of Object.entries(body)) {
        const firstNode = d.content?.[0]
        if (firstNode?.type !== 'heading') continue
        own[lang] = (firstNode.content ?? []).map(n => n.text ?? '').join('').trim()
        if (own[lang]) body[lang] = { type: 'doc', content: d.content!.slice(1) }
      }
      heading = text(own) ?? nameHeading()
    }
    return { id, heading, body }
  }
  // The champion's own about text: the plugin's default was lorem ipsum or, on Ramadan,
  // v3's standard text. Outside the Ramadan template its first heading was its title.
  const about = await docs(Object.fromEntries(Object.entries(field('what_content')).filter(([, v]) => !/^\s*lorem ipsum/i.test(plain(v)))))
  const aboutTitles: Record<string, string> = {}
  for (const [lang, d] of Object.entries(about)) {
    if (input.ramadan && isTemplateDoc('about', d, 'ramadan', lang)) {
      delete about[lang]
      continue
    }
    const firstNode = d.content?.[0]
    if (input.ramadan || firstNode?.type !== 'heading') continue
    const title = (firstNode.content ?? []).map(n => n.text ?? '').join('').trim()
    if (!title) continue
    aboutTitles[lang] = title
    about[lang] = { type: 'doc', content: d.content!.slice(1) }
  }
  const custom: LandingCustomSection[] = []
  const footer = await section('footer', field('footer_content'), null)
  if (footer) custom.push(footer)
  const landing: CampaignLanding = {
    ...(subtitle ? { subtitle } : {}),
    ...(Object.keys(why).length ? { why } : {}),
    ...(Object.keys(about).length ? { about } : {}),
    ...(custom.length ? { custom } : {}),
    ...(footer ? { order: [...defaultLandingOrder(custom.map(c => c.id)).filter(k => k !== customSectionKey('footer')), customSectionKey('footer')] } : {})
  }

  // Older campaigns keep the email texts per language in `campaign_strings`.
  const strings = (unserialize(first(meta, 'campaign_strings')) ?? {}) as Record<string, Record<string, string> | undefined>
  const withStrings = (key: string) => {
    const values = field(key)
    for (const [locale, s] of Object.entries(strings ?? {})) {
      const lang = languageOf(locale)
      const v = typeof s?.[key] === 'string' ? s[key]!.trim() : ''
      if (v && !values[lang] && input.languages.includes(lang)) values[lang] = v
    }
    return values
  }
  const tagline = text(field('email_tagline'))
  const welcome = await docs(withStrings('signup_content'))
  const reminder = await docs(withStrings('reminder_content'))
  const emailText: CampaignEmailText = {
    ...(tagline ? { tagline } : {}),
    ...(Object.keys(welcome).length ? { welcome } : {}),
    ...(Object.keys(reminder).length ? { reminder } : {})
  }

  const siteStrings: LandingText['siteStrings'] = []
  for (const [key, wpKey] of [['landing.why.title', 'vision_title'], ['landing.today.title', 'prayer_fuel_title']] as const) {
    const values = field(wpKey)
    if (!changed(wpKey, values)) continue
    for (const [language, value] of Object.entries(values)) if (plain(value)) siteStrings.push({ key, language, value: plain(value) })
  }
  for (const [language, value] of Object.entries(aboutTitles)) siteStrings.push({ key: 'landing.about.title', language, value })

  // Replies go where the champion set them, else to the address they sent from.
  const address = (v: string | null) => {
    if (!v) return null
    const { normalized, valid } = normalizeEmail(v)
    return valid ? normalized : null
  }
  const replyTo = address(first(meta, 'reply_to_email')) ?? address(first(meta, 'from_email'))
  const image = async (key: string) => {
    const url = first(meta, key)?.trim()
    return url && /^https?:\/\//.test(url) && !isPluginDefault(url) ? await input.rewriteUrl(url) : null
  }
  const emailLogo = await image('email_logo')
  const siteLogo = await image('logo_url')
  const signature = text(field('email_signature'))
  const fromName = first(meta, 'from_name')?.trim()
  return {
    description: subtitle,
    landing,
    emailText,
    placeName: first(meta, 'country_name')?.trim() || null,
    peopleGroup: first(meta, 'people_name')?.trim() || null,
    siteStrings,
    emailIdentity: {
      ...(fromName ? { from_name: plain(fromName).slice(0, 100) } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(emailLogo ? { logo_url: emailLogo } : {}),
      ...(signature ? { signature } : {})
    },
    siteLogoUrl: siteLogo
  }
}
