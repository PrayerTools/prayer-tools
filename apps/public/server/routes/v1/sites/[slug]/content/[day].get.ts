// Prayer content as Tiptap JSON by site / campaign / day / language, with
// placeholders filled; only the days the campaign's prayer pages show.
// Shared and edge-cacheable.
import { withOrg } from '@prayertools/shared/db/scope'
import { dayContent } from '@prayertools/shared/content'
import { fillVars, mapText } from '@prayertools/shared/tiptap'
import { useDb } from '../../../../../utils/db'
import { SHARED_CACHE, setCache } from '../../../../../utils/request'
import { apiSite } from '../../../../../utils/app-api'
import { contentVars, visibleEntries } from '../../../../../utils/content'
import { campaignView, loadSiteData } from '../../../../../utils/site-data'

export default defineEventHandler(async (event) => {
  const site = await apiSite(getRouterParam(event, 'slug'))
  const day = Number(getRouterParam(event, 'day'))
  if (!Number.isInteger(day) || day < 1 || day > 10_000) throw createError({ statusCode: 404 })
  const q = getQuery(event)
  const body = await withOrg(useDb(), site.orgId, async (tx) => {
    const data = await loadSiteData(tx)
    const wanted = typeof q.campaign === 'string' ? q.campaign : 'current'
    const campaign = wanted === 'current' ? data.current?.campaign : data.campaigns.find(c => c.id === wanted || c.slug === wanted)
    if (!campaign) return null
    const { max } = await visibleEntries(tx, campaign, campaignView(data, campaign), false)
    if (day > max) return null
    const lang = typeof q.language === 'string' && data.site.languages.includes(q.language) ? q.language : data.site.default_language
    const vars = contentVars(data, site.name, campaign, lang)
    const blocks = await dayContent(tx, campaign.id, day, lang, data.site.default_language)
    return {
      campaign: { id: campaign.id, slug: campaign.slug, name: campaign.name },
      day,
      language: lang,
      blocks: blocks.map(b => ({ title: b.title, language: b.language, credit: b.credit, license: b.license, doc: mapText(b.doc, t => fillVars(t, vars)) }))
    }
  })
  if (!body) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  setCache(event, SHARED_CACHE)
  return body
})
