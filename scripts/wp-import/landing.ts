// WordPress landing page and email texts → v3 campaign landing, email text
// and place, and the site's strings and email identity. WordPress keeps each
// text in the campaign's own language on the campaign, and its other
// languages in `dt_translations`.
import type { SQL } from 'bun'
import type { CampaignEmailText, CampaignLanding, LandingCustomSection, TiptapDoc, TiptapNode, TranslatableText } from '@prayertools/shared/db/schema'
import { customSectionKey, defaultLandingOrder } from '@prayertools/shared/landing'
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

// The plugin's English defaults: a text equal to its default wasn't written by the champion.
const DEFAULTS: Record<string, string> = {
  vision_title: 'Our Vision',
  vision: 'We want to cover this region with continuous 24/7 prayer.',
  pray_section_title: 'Extraordinary Prayer',
  pray_section_text: 'Every disciple making movement in history has happened in the context of extraordinary prayer.',
  movement_section_title: 'Movement Focused',
  movement_section_text: 'Join us in asking, seeking, and knocking for streams of disciples and churches to be made.',
  time_section_title: '24/7 Every Day',
  time_section_text: 'Choose a 15-minute (or more!) time slot that you can pray during each day. Invite someone else to sign up too.',
  prayer_fuel_title: 'Prayer Fuel'
}
const COLUMNS = ['pray', 'movement', 'time'] as const

// "About Ramadan" in the plugin's translations, for the Ramadan page's about section.
const ABOUT_RAMADAN: Record<string, string> = {
  en: 'About Ramadan', ar: 'عن رمضان', de: 'Über Ramadan', es: 'Acerca del Ramadán', fr: 'À propos du Ramadan', hi: 'रमज़ान के बारे में',
  id: 'Tentang Ramadan', it: 'Informazioni sul Ramadan', kn: 'ರಂಜಾನ್ ಬಗ್ಗೆ', ko: '라마단에 대해', ne: 'रमजानको बारेमा', nl: 'Over Ramadan',
  pt: 'Sobre o Ramadã', ro: 'Despre Ramadan', ru: 'О Рамадане', ta: 'ரமலான் பற்றி', te: 'రంజాన్ గురించి', tr: 'Ramazan Hakkında',
  uk: 'Про Рамадан', ur: 'رمضان کے بارے میں', vi: 'Về Ramadan', wo: 'Lu jëm ci Koor', 'zh-hans': '关于斋月', 'zh-hant': '關於齋月'
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
const plain = (html: string) => norm(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, '\'').replace(/&quot;/g, '"'))

export interface LandingInput {
  defaultLanguage: string
  languages: string[]
  ramadan: boolean
  campaignName: string
  rewrite(doc: TiptapDoc): Promise<TiptapDoc>
  // The stored copy, the URL itself when on another host, or null to drop it.
  rewriteUrl(url: string): Promise<string | null>
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

  // The vision section, with the three columns under it when the champion changed them.
  const vision = field('vision')
  const visionChanged = changed('vision', vision)
  const columns = COLUMNS.map(c => ({ title: field(`${c}_section_title`), body: field(`${c}_section_text`), c }))
  const columnsChanged = columns.some(c => changed(`${c.c}_section_title`, c.title) || changed(`${c.c}_section_text`, c.body))
  const why: Record<string, TiptapDoc> = {}
  if (visionChanged || columnsChanged) {
    const langs = new Set([...(visionChanged ? Object.keys(vision) : []), ...(columnsChanged ? columns.flatMap(c => [...Object.keys(c.title), ...Object.keys(c.body)]) : [])])
    for (const lang of langs) {
      const content: TiptapNode[] = visionChanged && (vision[lang] ?? vision[def]) ? await doc(vision[lang] ?? vision[def]!) : []
      if (columnsChanged) {
        for (const c of columns) {
          const title = plain(c.title[lang] ?? c.title[def] ?? DEFAULTS[`${c.c}_section_title`]!)
          content.push({ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: title }] }, ...await doc(c.body[lang] ?? c.body[def] ?? DEFAULTS[`${c.c}_section_text`]!))
        }
      }
      if (content.length) why[lang] = { type: 'doc', content }
    }
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
  const about = field('what_content')
  if (Object.values(about).every(v => /^\s*lorem ipsum/i.test(plain(v)))) for (const k of Object.keys(about)) delete about[k]
  const ramadanHeading: TranslatableText | null = input.ramadan
    ? { source: 'en', values: Object.fromEntries([...new Set(['en', ...input.languages])].filter(l => ABOUT_RAMADAN[l]).map(l => [l, ABOUT_RAMADAN[l]!])), stale: [] }
    : null
  const custom: LandingCustomSection[] = []
  const aboutSection = await section('about', about, ramadanHeading)
  const video = first(meta, 'promo_video_url')?.trim()
  const videoUrl = video && videoEmbed(video) ? video : null
  if (aboutSection) custom.push({ ...aboutSection, ...(videoUrl ? { video_url: videoUrl } : {}) })
  else if (videoUrl) custom.push({ id: 'about', heading: ramadanHeading ?? nameHeading(), body: {}, video_url: videoUrl })
  const footer = await section('footer', field('footer_content'), null)
  if (footer) custom.push(footer)
  const landing: CampaignLanding = {
    ...(subtitle ? { subtitle } : {}),
    ...(Object.keys(why).length ? { why } : {}),
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
