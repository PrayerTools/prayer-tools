// Editors change an intercessor's status, language or timezone, and the name
// of someone without an account (an account's name is the person's own).
import { isValidTimezone } from '@prayertools/shared/dates'
import { refreshReminders, setSubscriptionStatus } from '@prayertools/shared/subscriptions'

export default definePtHandler('pt.intercessors.write', async (event, tx) => {
  const id = getRouterParam(event, 'id')!
  const b = await ptBody<{ status?: string, language?: string, timezone?: string, name?: string }>(event)
  const site = await ptSite(tx)
  const sub = await tx.selectFrom('pt_subscription').select(['id', 'contact_id', 'user_id']).where('id', '=', id).executeTakeFirst()
  if (!sub) ptNotFound('Intercessor not found.')
  if (typeof b.name === 'string' && sub.user_id) ptBadRequest('Their name comes from their account. Send them a sign-in link to change it.')
  if (b.status) {
    if (!['active', 'inactive', 'completed', 'unsubscribed'].includes(b.status)) ptBadRequest('Unknown status.')
    await setSubscriptionStatus(ptTx(tx), id, b.status as never)
  }
  if (b.language) {
    if (!site.languages.includes(b.language)) ptBadRequest('Not a site language.')
    await tx.updateTable('pt_subscription').set({ language: b.language, updated_at: new Date() }).where('id', '=', id).execute()
  }
  if (b.timezone) {
    if (!isValidTimezone(b.timezone)) ptBadRequest('Unknown timezone.')
    await tx.updateTable('pt_subscription').set({ timezone: b.timezone, updated_at: new Date() }).where('id', '=', id).execute()
    await refreshReminders(ptTx(tx), id)
  }
  if (typeof b.name === 'string' && b.name.trim() && sub.contact_id) {
    await tx.updateTable('crm_records').set({ name: b.name.trim().slice(0, 200), updated_at: new Date() }).where('id', '=', sub.contact_id).execute()
  }
  return { ok: true }
})
