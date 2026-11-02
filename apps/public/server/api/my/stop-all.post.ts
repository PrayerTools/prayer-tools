// Stop all prayer reminders and emails: every site the person prays with, and
// News from Prayer.Tools.
import { unsubscribeEverywhere } from '@prayertools/shared/unsubscribe-all'
import { useDb } from '../../utils/db'
import { clientIp, limit, requestHost } from '../../utils/request'
import { requireSessionUser } from '../../utils/account-session'
import { staffOrgId } from '../../utils/staff'

export default defineEventHandler(async (event) => {
  limit(event, 'my-stop-all', 5, 60_000)
  const userId = await requireSessionUser(event)
  await unsubscribeEverywhere(useDb(), userId, {
    newsOrgId: await staffOrgId(),
    capture: { wording: { key: 'my.stop_all' }, surface: 'my_prayer', source: requestHost(event), ip: clientIp(event), userAgent: getRequestHeader(event, 'user-agent') ?? null }
  })
  return { ok: true }
})
