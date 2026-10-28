import { campaignStatus, displayLength } from '@prayertools/shared/setup'
import { campaignById } from '@prayertools/shared/campaigns'
import { goalProgress } from '@prayertools/shared/stats'
import { campaignEntries, campaignLibraries, contentLength } from '@prayertools/shared/content'

export default definePtHandler('pt.site.read', async (event, tx) => {
  const id = getRouterParam(event, 'id')!
  const site = await ptSite(tx)
  const c = await campaignById(ptTx(tx), id, { drafts: true })
  if (!c) ptNotFound('Campaign not found.')
  const commitments = await tx.selectFrom('pt_commitment').select(eb => eb.fn.countAll<string>().as('n')).where('campaign_id', '=', c.id).executeTakeFirst()
  return {
    campaign: {
      ...c,
      status: campaignStatus(c),
      length: displayLength(c),
      entries: await campaignEntries(ptTx(tx), c),
      commitments: Number(commitments?.n ?? 0),
      contentEntries: await contentLength(ptTx(tx), c.id),
      progress: await goalProgress(ptTx(tx), c, site.settings_merged.default_duration_min),
      // The place wording matters only when the campaign's content names the place.
      usesPlaceWording: await ptCampaignUsesPlacePhrases(tx, c.id, { name: true })
    },
    libraries: await campaignLibraries(ptTx(tx), c.id)
  }
})
