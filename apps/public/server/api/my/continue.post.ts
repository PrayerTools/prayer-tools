// The person confirmed signing in to a site that is not yet theirs.
import { safeReturnPath } from '@prayertools/shared/auth-codes'
import { handoffUrl, siteForHandoff } from '../../utils/account-links'
import { requireSessionUser } from '../../utils/account-session'
import { limit, readJson } from '../../utils/request'

export default defineEventHandler(async (event) => {
  limit(event, 'my', 60, 60_000)
  const userId = await requireSessionUser(event)
  const body = await readJson(event)
  const site = await siteForHandoff(body.host)
  if (!site) throw createError({ statusCode: 400, statusMessage: 'Unknown site' })
  return { url: await handoffUrl(userId, site.host, safeReturnPath(body.return)) }
})
