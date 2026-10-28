// Site info for the app: branding (the hero image is the current campaign's),
// languages, current campaign, stats and praying now. Public and edge-cacheable.
import { withOrg } from '@prayertools/shared/db/scope'
import { goalProgress, prayingNow } from '@prayertools/shared/stats'
import { pickCurrentCampaign } from '@prayertools/shared/setup'
import { siteSettings, siteUrlFor } from '@prayertools/shared/site'
import { textIn } from '@prayertools/shared/translatable'
import { brandColor } from '@prayertools/shared/colors'
import { getLanguage } from '@prayertools/shared/languages'
import type { CampaignBranding, SiteBranding, TranslatableText } from '@prayertools/shared/db/schema'
import { useDb } from '../../../../utils/db'
import { SHORT_CACHE, setCache } from '../../../../utils/request'
import { apiSite, campaignJson, campaignsOf } from '../../../../utils/app-api'

export default defineEventHandler(async (event) => {
  const site = await apiSite(getRouterParam(event, 'slug'))
  const q = getQuery(event)
  const body = await withOrg(useDb(), site.orgId, async (tx) => {
    const row = await tx.selectFrom('pt_site').selectAll().executeTakeFirstOrThrow()
    const lang = typeof q.language === 'string' && row.languages.includes(q.language) ? q.language : row.default_language
    const settings = siteSettings(row.settings)
    const campaigns = await campaignsOf(tx)
    const current = pickCurrentCampaign(campaigns)
    const branding = (row.branding ?? {}) as SiteBranding
    const hero = (current?.campaign.branding ?? {}) as CampaignBranding
    const bc = brandColor(branding.color)
    return {
      slug: site.slug,
      name: site.name,
      status: row.status,
      url: await siteUrlFor(tx, site.orgId, site.slug),
      description: textIn(row.description as TranslatableText | null, lang, row.default_language),
      language: lang,
      default_language: row.default_language,
      languages: row.languages.map(code => ({ code, name: getLanguage(code)?.native ?? code, dir: getLanguage(code)?.dir ?? 'ltr' })),
      timezone: row.timezone,
      branding: { color: bc.color, text_color: bc.textColor, logo_url: branding.logo_url ?? null, image_url: hero.image_url ?? null, image_alt: textIn(hero.image_alt, lang, row.default_language), image_credit: hero.image_credit ?? null, focal_x: hero.focal_x ?? 0.5, focal_y: hero.focal_y ?? 0.5 },
      current_campaign: current ? { ...campaignJson(current.campaign, settings.default_duration_min), state: current.state } : null,
      campaigns: campaigns.map(c => campaignJson(c, settings.default_duration_min)),
      stats: current ? await goalProgress(tx, current.campaign, settings.default_duration_min) : null,
      praying_now: settings.show_praying_now ? await prayingNow(tx) : null,
      show_people_count: settings.show_people_count
    }
  })
  setCache(event, SHORT_CACHE)
  return body
})
