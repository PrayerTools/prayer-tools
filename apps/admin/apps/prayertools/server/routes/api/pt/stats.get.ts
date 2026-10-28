// Campaign stats from the daily rollups: people, goal progress, commitments,
// prayer activity, praying now, anonymous app users, visitors, sources,
// countries and shares.
// Counts only; no personal data.
import { sql } from 'kysely'
import { goalProgress, prayingNow, statTotals, activeRules } from '@prayertools/shared/stats'
import { buildGrid, coverageByDay } from '@prayertools/shared/coverage'
import { campaignStatus, displayLength, slotMinutes } from '@prayertools/shared/setup'
import { toIsoDate } from '@prayertools/shared/dates'
import { campaignById } from '@prayertools/shared/campaigns'

export default definePtHandler('pt.stats.read', async (event, tx) => {
  const q = getQuery(event)
  const site = await ptSite(tx)
  const t = ptTx(tx)
  const campaign = await campaignById(t, q.campaign, { drafts: true })
  const totals = await statTotals(t, campaign?.id ?? null)
  const series = await tx.selectFrom('pt_stat_daily').select(['day', 'metric', 'value'])
    .$if(!!campaign, qb => qb.where('campaign_id', '=', campaign!.id))
    .where('day', '>=', sql<string>`(current_date - interval '120 days')::date`)
    .orderBy('day').execute()
  const dims = await tx.selectFrom('pt_stat_dim_daily').select(['dim', 'key', eb => eb.fn.sum<string>('value').as('total')])
    .$if(!!campaign, qb => qb.where('campaign_id', '=', campaign!.id))
    .groupBy(['dim', 'key']).execute()
  const topDims: Record<string, { key: string, total: number }[]> = {}
  for (const d of dims) (topDims[d.dim] ??= []).push({ key: d.key, total: Number(d.total) })
  for (const k of Object.keys(topDims)) topDims[k] = topDims[k]!.sort((a, b) => b.total - a.total).slice(0, 15)
  let progress = null
  let coverage = null
  let commitments = 0
  if (campaign) {
    progress = await goalProgress(t, campaign, site.settings_merged.default_duration_min)
    const cRow = await tx.selectFrom('pt_commitment').select(eb => eb.fn.countAll<string>().as('n')).where('campaign_id', '=', campaign.id).executeTakeFirst()
    commitments = Number(cRow?.n ?? 0)
    if (campaign.goal === 'coverage' && campaign.start_date && campaign.end_date) {
      const grid = buildGrid(campaign.start_date, campaign.end_date, campaign.timezone, await activeRules(t, campaign.id), site.settings_merged.default_duration_min, slotMinutes(campaign))
      coverage = coverageByDay(grid, campaign.start_date, campaign.end_date, campaign.timezone).map(d => ({ date: d.date, percent: d.percent }))
    }
  }
  const anon = await tx.selectFrom('pt_subscription as s').select(eb => eb.fn.countAll<string>().as('n'))
    .where('s.contact_id', 'is', null).where('s.delivery', '=', 'app').where('s.status', '=', 'active')
    .$if(!!campaign, qb => qb.where(eb => eb.exists(eb.selectFrom('pt_commitment as c').select('c.id').whereRef('c.subscription_id', '=', 's.id').where('c.campaign_id', '=', campaign!.id))))
    .executeTakeFirst()
  return {
    campaign: campaign ? { ...campaign, status: campaignStatus(campaign), length: displayLength(campaign) } : null,
    totals,
    series: series.map(s => ({ day: toIsoDate(s.day as unknown as Date), metric: s.metric, value: Number(s.value) })),
    dims: topDims,
    progress,
    coverage,
    commitments,
    prayingNow: await prayingNow(t),
    anonymousApp: Number(anon?.n ?? 0)
  }
})
