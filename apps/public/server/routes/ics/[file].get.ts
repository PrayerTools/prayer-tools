// Calendar file `/ics/<personal token>.ics` with all the person's prayer times;
// WordPress-era ICS keys redirect here, so calendars subscribed to those keep updating.
import { withOrg } from '@prayertools/shared/db/scope'
import { parsePersonalToken, personalToken } from '@prayertools/shared/links'
import { useDb } from '../../utils/db'
import { siteContext } from '../../utils/site-context'
import { subscriptionFeed } from '../../utils/ics'
import { legacySubscription } from '../../utils/actions'
import { PRIVATE_CACHE, setCache } from '../../utils/request'

export default defineEventHandler(async (event) => {
  const ctx = siteContext(event)
  const token = (getRouterParam(event, 'file') ?? '').replace(/\.ics$/, '')
  const subscriptionId = parsePersonalToken(token, ctx.orgId)
  setCache(event, PRIVATE_CACHE)
  if (!subscriptionId) {
    const legacy = await legacySubscription(ctx.orgId, 'ics', token)
    if (legacy) return sendRedirect(event, `/ics/${personalToken(ctx.orgId, legacy.id)}.ics`, 301)
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  const body = await withOrg(useDb(), ctx.orgId, async (tx) => {
    const sub = await tx.selectFrom('pt_subscription').selectAll().where('id', '=', subscriptionId).executeTakeFirst()
    return sub ? await subscriptionFeed(tx, ctx, sub) : null
  })
  if (!body) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  setResponseHeader(event, 'content-type', 'text/calendar; charset=utf-8')
  setResponseHeader(event, 'content-disposition', 'attachment; filename="prayer-times.ics"')
  return body
})
