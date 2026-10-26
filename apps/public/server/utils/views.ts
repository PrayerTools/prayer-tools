// Builds the view for a site page: parses `/{lang?}/{campaign?}/{page}/…`,
// picks the campaign and loads what the page shows, all inside the site's org.
import type { H3Event } from 'h3'
import { withOrg } from '@prayertools/shared/db/scope'
import { parseSitePath } from '@prayertools/shared/paths'
import { visibleSections } from '@prayertools/shared/landing'
import { landingWhyDoc } from '@prayertools/shared/i18n/landing'
import { prayingNow } from '@prayertools/shared/stats'
import { entryDate } from '@prayertools/shared/schedule'
import { parseLink } from '@prayertools/shared/links'
import { textIn } from '@prayertools/shared/translatable'
import { videoEmbed } from '@prayertools/shared/video'
import type { TranslatableText, CampaignCta, SignupFieldKind } from '@prayertools/shared/db/schema'
import type { CampaignRow } from '@prayertools/shared/subscriptions'
import { platformConfig } from '@prayertools/shared/config'
import { isSideCampaign } from '@prayertools/shared/setup'
import type { PageView, SiteResponse } from '../../shared/view'
import { useDb } from './db'
import type { SiteContext } from './site-context'
import { buildSiteView, campaignView, landingSource, loadSiteData, sideCampaigns, stateOf, type SiteData } from './site-data'
import { contentBlocks, contentVars, docHtml, formatDate, lastEntry } from './content'
import { progressFor, statsFor } from './site-stats'
import { managedSubscription, manageView } from './manage'
import { withDraftStrings, type LandingDraft } from './editor'

const PRIVATE_PAGES = new Set(['manage', 'm', 'u', 'verify', 'notice', 'checkin'])
const ARCHIVED_ALLOWED = new Set(['manage', 'm', 'u', 'verify', 'notice'])
export const NOTICE_KEYS = new Set([
  'checkin_yes', 'checkin_sometimes', 'checkin_no', 'link_invalid', 'unsubscribed', 'verify_invalid', 'deleted', 'not_found'
])

export function appAvailable(): boolean {
  const c = platformConfig()
  return !!(c.appStoreUrl || c.playStoreUrl)
}

export async function buildSiteResponse(event: H3Event, ctx: SiteContext, fullPath: string, draft?: LandingDraft): Promise<SiteResponse> {
  const url = new URL(fullPath, 'http://x')
  return await withOrg(useDb(), ctx.orgId, async (tx) => {
    const data = await loadSiteData(tx)
    const parsed = parseSitePath(url.pathname, data.site.languages, data.campaigns.map(c => c.slug))
    const lang = parsed.lang ?? data.site.default_language
    const def = data.site.default_language
    let campaign = parsed.campaignSlug
      ? data.campaigns.find(c => c.slug === parsed.campaignSlug) ?? null
      : data.current?.campaign ?? null
    // The editor's draft is the landing page of the page it previews.
    if (draft && campaign && isSideCampaign(campaign)) {
      const edited = { ...campaign, landing: draft.landing, description: draft.description }
      data.campaigns = data.campaigns.map(c => c.id === edited.id ? edited : c)
      campaign = edited
    } else if (draft) {
      data.site = { ...data.site, landing: draft.landing, description: draft.description }
    }
    const site = await buildSiteView(tx, ctx, data, lang, campaign, url.pathname)
    if (draft) site.strings = withDraftStrings(site.strings, draft.strings)
    const cv = site.campaign
    let status = 200
    let page: PageView

    const pageName = parsed.page
    const archived = data.site.status === 'archived' && !ARCHIVED_ALLOWED.has(pageName)

    if (archived) {
      page = { kind: 'archived' }
    } else {
      switch (pageName) {
        case '':
          page = parsed.rest.length ? { kind: 'not_found' } : await landingPage(tx, ctx, data, campaign, lang)
          break
        case 'pray':
          page = await prayPage(tx, ctx, data, campaign, lang, parsed.rest)
          break
        case 'signup':
          page = cv && (cv.state === 'between' || cv.state === 'ended')
            ? await betweenPage(tx, data, campaign!, lang)
            : { kind: 'signup', form: await signupForm(tx, data, lang, !!cv && (cv.state === 'upcoming' || cv.state === 'active')) }
          break
        case 'stats':
          page = campaign ? { kind: 'stats', stats: await statsFor(tx, campaign, data.settings.default_duration_min) } : { kind: 'not_found' }
          break
        case 'coverage':
        case 'calendar':
          page = campaign?.goal === 'coverage'
            ? { kind: 'coverage', progress: await progressFor(tx, campaign, data.settings.default_duration_min) }
            : { kind: 'not_found' }
          break
        case 'contact':
          page = { kind: 'contact' }
          break
        case 'stories':
        case 'story':
          page = { kind: 'stories' }
          break
        case 'manage': {
          const sub = await managedSubscription(tx, event, ctx.orgId)
          page = { kind: 'manage', manage: sub ? await manageView(tx, ctx, sub, data.campaigns, lang, def) : null }
          break
        }
        case 'm':
          page = { kind: 'link_expired', token: parsed.rest[0] ?? '' }
          break
        case 'u': {
          const token = parsed.rest[0] ?? ''
          const link = parseLink(token, 'u')
          let valid = false
          if (link && link.orgId === ctx.orgId) {
            valid = !!(await tx.selectFrom('pt_subscription').select('id').where('id', '=', link.subscriptionId).executeTakeFirst())
          }
          page = { kind: 'unsubscribe', token, valid }
          break
        }
        case 'verify':
          page = { kind: 'notice', key: 'verify_invalid' }
          break
        case 'notice': {
          const key = parsed.rest[0] ?? ''
          page = NOTICE_KEYS.has(key) ? { kind: 'notice', key } : { kind: 'not_found' }
          break
        }
        case 'embed':
          page = { kind: 'embed', progress: campaign ? await progressFor(tx, campaign, data.settings.default_duration_min) : null }
          break
        default:
          page = { kind: 'not_found' }
      }
    }
    if (page.kind === 'not_found') status = 404
    const personal = PRIVATE_PAGES.has(pageName) || ctx.preview || data.site.status === 'draft'
    return {
      host: 'site',
      site,
      page,
      status,
      cache: personal ? 'private' : 'shared',
      title: ctx.name,
      robots: personal ? 'noindex' : undefined,
      canonical: `${ctx.canonicalOrigin}${url.pathname === '/' ? '' : url.pathname}`
    }
  })
}

async function landingPage(tx: Parameters<typeof loadSiteData>[0], ctx: SiteContext, data: SiteData, campaign: CampaignRow | null, lang: string): Promise<PageView> {
  const def = data.site.default_language
  if (campaign) {
    const state = stateOf(data, campaign)
    if (state === 'between' || state === 'ended') return await betweenPage(tx, data, campaign, lang)
  }
  const { landing, templateKey } = landingSource(data, campaign)
  const side = !!campaign && isSideCampaign(campaign)
  const vars = campaign ? contentVars(data, ctx.name, campaign, lang) : undefined
  const whyDoc = landingWhyDoc(landing.why, templateKey, lang, def)
  const why = whyDoc ? docHtml({ [lang]: whyDoc }, lang, def, vars) : ''
  const custom = (landing.custom ?? []).map(s => ({
    id: s.id,
    heading: textIn(s.heading, lang, def),
    html: docHtml(s.body, lang, def, vars),
    imageUrl: s.image_url ?? null,
    imageAlt: textIn(s.image_alt, lang, def),
    video: videoEmbed(s.video_url),
    buttonLabel: s.button_url ? textIn(s.button_label, lang, def) || null : null,
    buttonUrl: s.button_url ?? null
  })).filter(s => s.heading || s.html || s.video)
  let storyQuery = tx
    .selectFrom('pt_story')
    .select(['id', 'body', 'name', 'use_name'])
    .where('published', '=', true)
    .where('may_publish', '=', true)
  if (side) storyQuery = storyQuery.where('campaign_id', '=', campaign!.id)
  const stories = await storyQuery
    .orderBy('published_at', 'desc')
    .limit(6)
    .execute()
  let today: { day: number, html: string, title: string } | null = null
  if (campaign && stateOf(data, campaign) !== 'upcoming') {
    const cv = campaignView(data, campaign)
    const blocks = await contentBlocks(tx, data, ctx.name, campaign, cv.todayEntry, lang, 3)
    if (blocks[0]) today = { day: cv.todayEntry, html: blocks[0].html, title: blocks[0].title }
  }
  const sections = visibleSections(landing.hidden, templateKey, {
    hasStories: landing.stories !== false && stories.length > 0,
    hasCustom: custom.length > 0,
    hasWhy: !!why,
    appAvailable: appAvailable()
  }).filter(s => s !== 'today' || today)
  // In the admin editor, sections that are switched on but have nothing to
  // show yet appear as placeholders.
  const placeholders = ctx.editor
    ? visibleSections(landing.hidden, templateKey, { hasStories: true, hasCustom: true, hasWhy: true, appAvailable: true }).filter(s => !sections.includes(s))
    : []
  return {
    kind: 'landing',
    sections,
    progress: campaign ? await progressFor(tx, campaign, data.settings.default_duration_min) : null,
    why,
    today,
    stories: stories.map(s => ({ id: s.id, body: s.body, name: s.use_name ? s.name : null })),
    custom,
    prayingNow: data.settings.show_praying_now ? await prayingNow(tx) : 0,
    form: await signupForm(tx, data, lang, !!campaign),
    placeholders,
    side: side ? [] : sideCampaigns(data)
  }
}

async function betweenPage(tx: Parameters<typeof loadSiteData>[0], data: SiteData, campaign: CampaignRow, lang: string): Promise<PageView> {
  const def = data.site.default_language
  const cta = (campaign.cta ?? {}) as CampaignCta
  return {
    kind: 'between',
    stats: await statsFor(tx, campaign, data.settings.default_duration_min),
    endMessage: textIn(campaign.end_message as TranslatableText | null, lang, def),
    cta: cta.url ? { label: textIn(cta.label, lang, def), url: cta.url } : null
  }
}

async function prayPage(tx: Parameters<typeof loadSiteData>[0], ctx: SiteContext, data: SiteData, campaign: CampaignRow | null, lang: string, rest: string[]): Promise<PageView> {
  if (!campaign || rest.length > 1) return { kind: 'not_found' }
  const cv = campaignView(data, campaign)
  if (cv.state === 'upcoming' && campaign.start_date && !ctx.preview) return { kind: 'not_started', startDate: campaign.start_date }
  const last = await lastEntry(tx, campaign, cv.length)
  let day = cv.todayEntry
  if (rest[0] !== undefined) {
    if (!/^\d{1,5}$/.test(rest[0])) return { kind: 'not_found' }
    day = Number(rest[0])
  }
  if (day < 1 || (last > 0 && day > last)) return { kind: 'not_found' }
  const blocks = await contentBlocks(tx, data, ctx.name, campaign, day, lang)
  const maxDay = campaign.start_mode === 'date' && cv.state === 'active' ? Math.min(cv.todayEntry, last || cv.todayEntry) : last
  // Personal-start campaigns move each person forward one entry per day, so
  // their pages never link ahead.
  const personal = campaign.start_mode === 'join'
  return {
    kind: 'pray',
    day,
    chosen: rest[0] !== undefined,
    personal,
    dateLabel: campaign.start_mode === 'date' && campaign.start_date ? formatDate(entryDate(campaign.start_date, campaign.cadence, day), lang) : null,
    blocks,
    prev: day > 1 ? day - 1 : null,
    next: !personal && day < maxDay ? day + 1 : null,
    length: last || null
  }
}

async function signupForm(tx: Parameters<typeof loadSiteData>[0], data: SiteData, lang: string, open: boolean) {
  const def = data.site.default_language
  const options = await tx.selectFrom('pt_consent_option').select(['key', 'label']).where('active', '=', true).orderBy('position').execute()
  const fields = await tx.selectFrom('pt_signup_field').select(['key', 'kind', 'label', 'options', 'required']).orderBy('position').execute()
  return {
    consentOptions: options.map(o => ({ key: o.key, label: textIn(o.label as TranslatableText, lang, def) })),
    fields: fields.map(f => ({
      key: f.key,
      kind: f.kind as SignupFieldKind,
      label: textIn(f.label as TranslatableText, lang, def),
      required: f.required,
      options: ((f.options ?? []) as { key: string, label: TranslatableText }[]).map(o => ({ key: o.key, label: textIn(o.label, lang, def) }))
    })),
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    appleServicesId: process.env.APPLE_SERVICES_ID || null,
    open: open && data.site.status !== 'archived'
  }
}

