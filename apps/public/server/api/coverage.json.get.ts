// 24/7 coverage: per-day percent and per-slot counts from the commitments,
// computed in real instants (DST-exact) and cached briefly at the edge.
import { withOrg } from '@prayertools/shared/db/scope'
import { activeRules } from '@prayertools/shared/stats'
import { buildGrid, coverageByDay } from '@prayertools/shared/coverage'
import { siteSettings } from '@prayertools/shared/site'
import { pickCurrentCampaign, slotMinutes } from '@prayertools/shared/setup'
import { loadCampaigns } from '@prayertools/shared/campaigns'
import { useDb } from '../utils/db'
import { SHORT_CACHE, setCache } from '../utils/request'
import { siteContext } from '../utils/site-context'
import { isUuid } from '../lib/input'

export default defineEventHandler(async (event) => {
  const ctx = siteContext(event)
  const wanted = getQuery(event).campaign
  const result = await withOrg(useDb(), ctx.orgId, async (tx) => {
    const campaigns = await loadCampaigns(tx)
    const campaign = isUuid(wanted) ? campaigns.find(c => c.id === wanted) : pickCurrentCampaign(campaigns)?.campaign
    if (!campaign || campaign.goal !== 'coverage' || !campaign.start_date || !campaign.end_date) return null
    const site = await tx.selectFrom('pt_site').select('settings').executeTakeFirstOrThrow()
    const grid = buildGrid(campaign.start_date, campaign.end_date, campaign.timezone, await activeRules(tx, campaign.id), siteSettings(site.settings).default_duration_min, slotMinutes(campaign))
    let from = 0
    const days = coverageByDay(grid, campaign.start_date, campaign.end_date, campaign.timezone).map((d) => {
      const day = { date: d.date, percent: d.percent, from, to: from + d.slots.length }
      from += d.slots.length
      return day
    })
    return { start: grid.start.toISOString(), slotMinutes: grid.slotMinutes, timezone: campaign.timezone, days, slots: grid.slots }
  })
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  setCache(event, SHORT_CACHE)
  return result
})
