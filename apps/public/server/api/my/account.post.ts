// The person changes their name; every site's contact shows the new one.
import { useDb } from '../../utils/db'
import { readJson, str } from '../../utils/request'
import { syncAccountEverywhere } from '../../utils/my'
import { requireSessionUser } from '../../utils/account-session'

export default defineEventHandler(async (event) => {
  const userId = await requireSessionUser(event)
  const body = await readJson(event)
  const name = str(body.name, 200).trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: 'name' })
  await useDb().updateTable('users').set({ display_name: name, updated: new Date() }).where('id', '=', userId).execute()
  await syncAccountEverywhere(userId)
  return { ok: true }
})
