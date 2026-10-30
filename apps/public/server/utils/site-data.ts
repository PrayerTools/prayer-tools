// Site and campaign data every page needs, read inside the site's org.
import type { Selectable } from 'kysely'
import type { Tx } from '@prayertools/shared/db/scope'
import type { CampaignBranding, CampaignShare, PtSiteTable, SiteBranding, TranslatableText } from '@prayertools/shared/db/schema'
import { campaignLength, campaignStatus, defaultDuration, durationOptions, durationRule, isSideCampaign, pickCurrentCampaign, slotMinutes } from '@prayertools/shared/setup'
import { entryNumber } from '@prayertools/shared/schedule'
import { todayIn } from '@prayertools/shared/dates'
import type { CampaignRow } from '@prayertools/shared/subscriptions'
import { campaignSegment, loadCampaigns } from '@prayertools/shared/campaigns'
import { siteSettings, type SiteSettings } from '@prayertools/shared/site'
import { getLanguage, languageDir, UI_LANGUAGES } from '@prayertools/shared/languages'
import { textIn } from '@prayertools/shared/translatable'
import { heroAlt, heroImage } from '@prayertools/shared/hero-images'
import { brandColor } from '@prayertools/shared/colors'
import { goOrigin, platformConfig, platformOrigin } from '@prayertools/shared/config'
import { EDITABLE_SITE_STRINGS } from '@prayertools/shared/site-strings'
import type { CampaignState, CampaignView, SideCampaignView, SiteView } from '../../shared/view'
import type { SiteContext } from './site-context'
import { editorDefaults } from './editor'

export type SiteRow = Selectable<PtSiteTable>

export interface SiteData {
  site: SiteRow
  campaigns: CampaignRow[]
  current: { campaign: CampaignRow, state: 'upcoming' | 'active' | 'between' } | null
  settings: SiteSettings
}

export { UI_LANGUAGES }

// Draft campaigns are left out unless `drafts` (preview links and the admin editor).
export async function loadSiteData(tx: Tx, opts: { drafts?: boolean } = {}): Promise<SiteData> {
  const site = await tx.selectFrom('pt_site').selectAll().executeTakeFirst()
  if (!site) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const campaigns = await loadCampaigns(tx, opts)
  return { site, campaigns, current: pickCurrentCampaign(campaigns), settings: siteSettings(site.settings) }
}

export function stateOf(data: SiteData, c: CampaignRow): CampaignState {
  if (data.current?.campaign.id === c.id) return data.current.state
  const s = campaignStatus(c)
  return s === 'ended' ? 'ended' : s
}

export function campaignView(data: SiteData, c: CampaignRow): CampaignView {
  const state = stateOf(data, c)
  const length = campaignLength(c)
  let todayEntry = 1
  if (c.start_mode === 'date' && c.start_date && state === 'active') {
    todayEntry = Math.max(1, entryNumber(c.start_date, c.cadence, todayIn(c.timezone)))
    if (length) todayEntry = Math.min(todayEntry, length)
  } else if (c.start_mode === 'date' && c.start_date && (state === 'between' || state === 'ended') && length) {
    todayEntry = length
  }
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    state,
    isCurrent: data.current?.campaign.id === c.id,
    side: isSideCampaign(c),
    goal: c.goal,
    goalTarget: c.goal_target,
    cadence: c.cadence,
    startMode: c.start_mode,
    startDate: c.start_date,
    endDate: c.end_date,
    timezone: c.timezone,
    length,
    durationRule: durationRule(c.goal, c.track_time),
    durations: durationOptions(c),
    defaultDuration: defaultDuration(c, data.settings.default_duration_min),
    slotMinutes: c.goal === 'coverage' ? slotMinutes(c) : null,
    todayEntry
  }
}

export function uiLanguage(lang: string): string {
  return UI_LANGUAGES.includes(lang) ? lang : 'en'
}

export async function siteStrings(tx: Tx, lang: string): Promise<Record<string, string>> {
  const rows = await tx
    .selectFrom('pt_site_string')
    .select(['key', 'value'])
    .where('language', '=', lang)
    .where('key', 'in', [...EDITABLE_SITE_STRINGS])
    .execute()
  return Object.fromEntries(rows.filter(r => r.value.trim()).map(r => [r.key, r.value]))
}

export function feedbackConfig(): SiteView['feedback'] {
  const f = platformConfig().feedback
  if (!f.projectId || !f.apiBase) return null
  const apiBase = f.apiBase.replace(/\/$/, '')
  return { scriptUrl: `${apiBase}/js/feedback-web-component.iife.js`, projectId: f.projectId, apiBase }
}

// Library hero images take their alt text from code unless the site wrote its own.
export function heroView(branding: CampaignBranding, lang: string, def: string): SiteView['image'] {
  if (!branding.image_url) return null
  const known = heroImage(branding.image_url)
  const alt = textIn(branding.image_alt, lang, def) || (known ? heroAlt(known, lang) : '')
  return { url: branding.image_url, alt, credit: branding.image_credit ?? null, fx: branding.focal_x ?? 0.5, fy: branding.focal_y ?? 0.5 }
}

export async function buildSiteView(tx: Tx, ctx: SiteContext, data: SiteData, lang: string, campaign: CampaignRow | null, path: string): Promise<SiteView> {
  const { site } = data
  const def = site.default_language
  const branding = (site.branding ?? {}) as SiteBranding
  const look = (campaign?.branding ?? {}) as CampaignBranding
  const share = (campaign?.share ?? {}) as CampaignShare
  const bc = brandColor(branding.color)
  const cv = campaign ? campaignView(data, campaign) : null
  const cfg = platformConfig()
  const image = heroView(look, lang, def)
  return {
    orgId: ctx.orgId,
    slug: ctx.slug,
    name: ctx.name,
    url: ctx.canonicalOrigin,
    path,
    lang,
    uiLang: uiLanguage(lang),
    dir: languageDir(lang),
    defaultLanguage: def,
    languages: site.languages.map(code => ({ code, native: getLanguage(code)?.native ?? code })),
    brand: { color: bc.color, text: bc.textColor },
    logoUrl: branding.logo_url ?? null,
    image,
    shareImageUrl: look.share_image_url ?? image?.url ?? null,
    description: textIn(campaign?.description as TranslatableText | null, lang, def),
    status: site.status,
    preview: ctx.preview,
    editor: ctx.editor ? { adminOrigin: new URL(cfg.adminUrl).origin, defaults: editorDefaults(uiLanguage(lang)) } : null,
    campaign: cv,
    campaignSegment: campaign ? campaignSegment(campaign, data.current?.campaign.id) : null,
    pastCampaigns: data.campaigns
      .filter(c => c.id !== data.current?.campaign.id && campaignStatus(c) === 'ended')
      .reverse()
      .map(c => ({ slug: c.slug, name: c.name })),
    strings: await siteStrings(tx, lang),
    shareMessage: share.messages?.values?.[lang] || null,
    settings: { showPeopleCount: data.settings.show_people_count, showPrayingNow: data.settings.show_praying_now, sharePrompts: data.settings.share_prompts },
    donateUrl: cfg.donateUrl,
    myUrl: `${platformOrigin()}/my`,
    privacyUrl: `${platformOrigin()}/privacy`,
    termsUrl: `${platformOrigin()}/terms`,
    goUrl: `${goOrigin()}/${ctx.slug}`,
    appStoreUrl: cfg.appStoreUrl || null,
    playStoreUrl: cfg.playStoreUrl || null,
    feedback: feedbackConfig(),
    turnstileSiteKey: process.env.NUXT_PUBLIC_TURNSTILE_SITE_KEY || null
  }
}

// Side campaigns open for signup or running now, soonest first.
export function sideCampaigns(data: SiteData, now: Date = new Date()): SideCampaignView[] {
  return data.campaigns
    .filter(c => isSideCampaign(c) && campaignStatus(c, now) !== 'ended')
    .sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''))
    .map(c => ({ slug: c.slug, name: c.name, state: campaignStatus(c, now) === 'upcoming' ? 'upcoming' : 'active', startDate: c.start_date, endDate: c.end_date }))
}
