// Turns News from Prayer.Tools on or off for the signed-in person.
import { accountById } from '@prayertools/shared/accounts'
import { useDb } from '../../utils/db'
import { clientIp, limit, readJson, requestHost } from '../../utils/request'
import { requireSessionUser } from '../../utils/account-session'
import { grantPlatformNews, withdrawPlatformNews } from '../../utils/staff'

export default defineEventHandler(async (event) => {
  limit(event, 'my', 60, 60_000)
  const userId = await requireSessionUser(event)
  const account = await accountById(useDb(), userId)
  if (!account?.email) throw createError({ statusCode: 400, statusMessage: 'email' })
  const body = await readJson(event)
  const capture = { surface: 'my_prayer', source: requestHost(event), ip: clientIp(event), userAgent: getRequestHeader(event, 'user-agent') ?? null }
  if (body.grant === true) await grantPlatformNews(account.email, account.display_name, capture)
  else await withdrawPlatformNews(userId, account.email, capture)
  return { ok: true }
})
