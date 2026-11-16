// Delete my prayer data on every site, then the account itself with its
// Google / Apple links and sign-ins, unless it is still in use (see
// deleteAccountOnRequest); the reply then says why it stays.
import { withOrg } from '@prayertools/shared/db/scope'
import { deleteSubscriptionData } from '@prayertools/shared/subscriptions'
import { deleteChannelIfUnused } from '@prayertools/shared/crm'
import { deleteAccountOnRequest } from '@prayertools/shared/accounts'
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
    await withOrg(useDb(), orgId, async (tx) => {
      const contacts = await tx.selectFrom('crm_records').select('id').where('user_id', '=', userId).execute()
      for (const c of contacts) {
        const channels = await tx.selectFrom('crm_contact_channels').select('channel_id').where('record_id', '=', c.id).execute()
        await tx.deleteFrom('crm_records').where('id', '=', c.id).execute()
        for (const ch of channels) await deleteChannelIfUnused(tx, ch.channel_id)
      }
    })
  }
  await endAccountSession(event)
  const res = await deleteAccountOnRequest(useDb(), userId)
  return res.deleted ? { ok: true, account_deleted: true } : { ok: true, account_deleted: false, kept_reason: res.reason }
})
