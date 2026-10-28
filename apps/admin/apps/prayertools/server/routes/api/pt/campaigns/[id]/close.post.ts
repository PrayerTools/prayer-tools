// Closes a campaign now. A dated campaign's end date becomes yesterday, so
// the site moves to "between campaigns" and the worker's daily run sends the
// thank-you; a personal-start campaign is marked ended.
import { todayIn, addDays } from '@prayertools/shared/dates'
import { campaignById } from '@prayertools/shared/campaigns'

export default definePtHandler('pt.campaigns.write', async (event, tx) => {
  const id = getRouterParam(event, 'id')!
  const c = await campaignById(ptTx(tx), id, { drafts: true })
  if (!c) ptNotFound('Campaign not found.')
  const yesterday = addDays(todayIn(c.timezone), -1)
  if (c.start_mode === 'date') {
    const end = c.start_date && c.start_date > yesterday ? c.start_date : yesterday
    await tx.updateTable('pt_campaign').set({ end_mode: 'date', end_date: end, updated_at: new Date() }).where('id', '=', id).execute()
  } else {
    await tx.updateTable('pt_campaign').set({ ended_at: new Date(), updated_at: new Date() }).where('id', '=', id).execute()
  }
  return { ok: true }
})
