// The admin landing-page editor shows the site in a frame. Its `pt_edit`
// token lets the admin origin frame the site (draft or published) and render
// the editor's unsaved landing page, hero image, color and logo.
import type { H3Event } from 'h3'
import type { CampaignBranding, CampaignLanding, LandingCustomSection, SiteBranding, TiptapDoc, TranslatableText } from '@prayertools/shared/db/schema'
import { editorTokenOrg } from '@prayertools/shared/links'
import { platformConfig } from '@prayertools/shared/config'
import { parseText } from '@prayertools/shared/translatable'
import { parseHex } from '@prayertools/shared/colors'
import { videoEmbed } from '@prayertools/shared/video'
import { EDITABLE_SITE_STRINGS } from '@prayertools/shared/site-strings'
import ar from '../../i18n/locales/ar.json'
import en from '../../i18n/locales/en.json'
import es from '../../i18n/locales/es.json'
import fr from '../../i18n/locales/fr.json'
import pt from '../../i18n/locales/pt.json'

const LOCALES: Record<string, unknown> = { ar, en, es, fr, pt }

export interface LandingDraft {
  landing: CampaignLanding
  description: TranslatableText | null
  // The campaign's hero image; absent when the editor sends none.
  branding?: CampaignBranding
  // The site's color and logo.
  brand?: SiteBranding
  // The editor's wording for the page language; an empty value means the standard wording.
  strings: Record<string, string>
}

export function editorAccess(event: H3Event, orgId: string): boolean {
  const token = getQuery(event).pt_edit
  return typeof token === 'string' && editorTokenOrg(token) === orgId
}

export function editorFrameAncestors(): string {
  return `frame-ancestors ${new URL(platformConfig().adminUrl).origin}`
}

// The standard wording of each editable string in a UI language, shown as the
// editor's placeholder text.
export function editorDefaults(uiLang: string): Record<string, string> {
  const messages = LOCALES[uiLang] ?? LOCALES.en
  const out: Record<string, string> = {}
  for (const key of EDITABLE_SITE_STRINGS) {
    const value = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], messages)
    if (typeof value === 'string') out[key] = value
  }
  return out
}

// The site's saved wording with the editor's unsaved wording on top.
export function withDraftStrings(saved: Record<string, string>, draft: Record<string, string>): Record<string, string> {
  const merged = { ...saved, ...draft }
  return Object.fromEntries(Object.entries(merged).filter(([, v]) => v.trim()))
}

function doc(input: unknown): TiptapDoc | null {
  const d = input as TiptapDoc | null
  return d && typeof d === 'object' && d.type === 'doc' && (d.content === undefined || Array.isArray(d.content)) ? d : null
}

function docs(input: unknown): Record<string, TiptapDoc> {
  const out: Record<string, TiptapDoc> = {}
  for (const [lang, d] of Object.entries((input && typeof input === 'object' ? input : {}) as Record<string, unknown>)) {
    const parsed = doc(d)
    if (parsed) out[lang] = parsed
  }
  return out
}

function url(v: unknown): string | undefined {
  return typeof v === 'string' && /^(https?:\/\/|\/)/.test(v.trim()) ? v.trim().slice(0, 2000) : undefined
}

function unit(v: unknown): number | undefined {
  return typeof v === 'number' && v >= 0 && v <= 1 ? v : undefined
}

function parseHero(input: unknown): CampaignBranding | undefined {
  if (!input || typeof input !== 'object') return undefined
  const b = input as Record<string, unknown>
  return {
    image_url: url(b.image_url),
    image_alt: parseText(b.image_alt) ?? undefined,
    image_credit: typeof b.image_credit === 'string' ? b.image_credit.slice(0, 200) : undefined,
    focal_x: unit(b.focal_x),
    focal_y: unit(b.focal_y),
    share_image_url: url(b.share_image_url)
  }
}

function parseBrand(input: unknown): SiteBranding | undefined {
  if (!input || typeof input !== 'object') return undefined
  const b = input as Record<string, unknown>
  return {
    color: typeof b.color === 'string' && parseHex(b.color) ? b.color : undefined,
    logo_url: url(b.logo_url)
  }
}

export function parseLandingDraft(input: unknown): LandingDraft {
  const b = (input ?? {}) as Record<string, unknown>
  const l = (b.landing ?? {}) as Record<string, unknown>
  const custom: LandingCustomSection[] = []
  for (const raw of Array.isArray(l.custom) ? (l.custom as Record<string, unknown>[]).slice(0, 12) : []) {
    const heading = parseText(raw?.heading)
    if (!heading) continue
    custom.push({
      id: typeof raw.id === 'string' ? raw.id.slice(0, 40) : crypto.randomUUID(),
      heading,
      body: docs(raw.body),
      image_url: url(raw.image_url),
      image_alt: parseText(raw.image_alt) ?? undefined,
      video_url: videoEmbed(url(raw.video_url)) ? url(raw.video_url) : undefined,
      button_label: parseText(raw.button_label) ?? undefined,
      button_url: url(raw.button_url)
    })
  }
  return {
    landing: {
      why: docs(l.why),
      hidden: Array.isArray(l.hidden) ? (l.hidden as unknown[]).filter((s): s is string => typeof s === 'string') : undefined,
      custom,
      stories: typeof l.stories === 'boolean' ? l.stories : undefined
    },
    description: parseText(b.description),
    branding: parseHero(b.branding),
    brand: parseBrand(b.brand),
    strings: parseStrings(b.strings)
  }
}

function parseStrings(input: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries((input && typeof input === 'object' ? input : {}) as Record<string, unknown>)) {
    if ((EDITABLE_SITE_STRINGS as readonly string[]).includes(key) && typeof value === 'string') out[key] = value.slice(0, 2000)
  }
  return out
}
