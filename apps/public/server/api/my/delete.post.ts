// Delete my prayer data on every site, then the account itself unless it is
// still in use (a site team, an admin app sign-in, an app install, or records
// it created in a site's CRM).
import { withOrg } from '@prayertools/shared/db/scope'
import { deleteSubscriptionData } from '@prayertools/shared/subscriptions'
import { deleteChannelIfUnused } from '@prayertools/shared/crm'
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
  let accountDeleted = false
  try {
    const res = await useDb()
      .deleteFrom('users')
      .where('id', '=', userId)
      .where('password', 'is', null)
      .where('is_admin', '=', false)
      .where(eb => eb.not(eb.exists(eb.selectFrom('memberships').select('memberships.id').whereRef('memberships.user_id', '=', 'users.id'))))
      .where(eb => eb.not(eb.exists(eb.selectFrom('pt_user_device').select('pt_user_device.id').whereRef('pt_user_device.user_id', '=', 'users.id'))))
      .where(eb => eb.not(eb.exists(eb.selectFrom('user_identities').select('user_identities.id').whereRef('user_identities.user_id', '=', 'users.id'))))
      .executeTakeFirst()
    accountDeleted = Number(res.numDeletedRows) > 0
  } catch (err) {
    // A record the account created in a site's CRM keeps it.
    if ((err as { code?: string }).code !== '23503') throw err
  }
  return { ok: true, account_deleted: accountDeleted }
})
