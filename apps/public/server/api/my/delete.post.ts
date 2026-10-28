// Delete my prayer data on every site, then the account itself unless it is
// still in use (a site team, a password sign-in, an app install).
import { withOrg } from '@prayertools/shared/db/scope'
import { deleteSubscriptionData } from '@prayertools/shared/subscriptions'
import { useDb } from '../../utils/db'
import { limit } from '../../utils/request'
import { accountSiteIds, personSubscriptions } from '../../utils/my'
import { endAccountSession, requireSessionUser } from '../../utils/account-session'

export default defineEventHandler(async (event) => {
  limit(event, 'my-delete', 3, 60_000)
  const userId = await requireSessionUser(event)
  const orgIds = await accountSiteIds(userId)
  for (const s of await personSubscriptions(userId)) {
    await withOrg(useDb(), s.org_id, tx => deleteSubscriptionData(tx, s.id))
  }
  // Contacts without a subscription here (the staff org's News from Prayer.Tools).
  for (const orgId of orgIds) {
    await withOrg(useDb(), orgId, tx => tx.updateTable('crm_records').set({ user_id: null }).where('user_id', '=', userId).execute())
  }
  await endAccountSession(event)
  await useDb()
    .deleteFrom('users')
    .where('id', '=', userId)
    .where('password', 'is', null)
    .where('is_admin', '=', false)
    .where(eb => eb.not(eb.exists(eb.selectFrom('memberships').select('memberships.id').whereRef('memberships.user_id', '=', 'users.id'))))
    .where(eb => eb.not(eb.exists(eb.selectFrom('pt_user_device').select('pt_user_device.id').whereRef('pt_user_device.user_id', '=', 'users.id'))))
    .execute()
  return { ok: true }
})
