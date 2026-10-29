// A name or email changed in the admin app's profile settings, or by an
// operator, is copied onto the person's contact on every site at once.
import { db } from '#core/server/utils/database'
import { accountById, accountOrgIds, syncAccountContacts } from '@prayertools/shared/accounts'
import { ptAdminDb, ptAppDb } from '../utils/pt-context'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('user.updated', async ({ userId }) => {
    const account = await accountById(ptAppDb(db), userId)
    if (account) await syncAccountContacts(ptAppDb(db), await accountOrgIds(ptAdminDb(), userId), account)
  })
})
