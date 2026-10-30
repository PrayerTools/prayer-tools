import { campaignStatus, displayLength } from '@prayertools/shared/setup'
import { goalProgress } from '@prayertools/shared/stats'
import { normalizeCampaign } from '@prayertools/shared/campaigns'

export default definePtHandler('pt.site.read', async (_event, tx) => {
  const site = await ptSite(tx)
  const rows = (await tx.selectFrom('pt_campaign').selectAll().orderBy('start_date', 'desc').orderBy('created_at', 'desc').execute()).map(normalizeCampaign)
  const counts = await tx.selectFrom('pt_commitment').select(['campaign_id', eb => eb.fn.countAll<string>().as('n')]).groupBy('campaign_id').execute()
  const commitments = new Map(counts.map(r => [r.campaign_id, Number(r.n)]))
  const campaigns = []
  for (const c of rows) {
    campaigns.push({
      ...c,
      status: campaignStatus(c),
      commitments: commitments.get(c.id) ?? 0,
      length: displayLength(c),
      progress: await goalProgress(ptTx(tx), c, site.settings_merged.default_duration_min)
    })
  }
  return { campaigns }
})
