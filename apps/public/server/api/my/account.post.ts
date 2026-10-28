// The person changes their name; every site's contact shows the new one.
import { accountById, syncAccountContacts } from '@prayertools/shared/accounts'
import { useDb } from '../../utils/db'
import { readJson, str } from '../../utils/request'
import { accountSiteIds } from '../../utils/my'
import { requireSessionUser } from '../../utils/account-session'

export default defineEventHandler(async (event) => {
  const userId = await requireSessionUser(event)
  const body = await readJson(event)
  const name = str(body.name, 200).trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: 'name' })
  const db = useDb()
  await db.updateTable('users').set({ display_name: name, updated: new Date() }).where('id', '=', userId).execute()
  await syncAccountContacts(db, await accountSiteIds(userId), (await accountById(db, userId))!)
  return { ok: true }
})
