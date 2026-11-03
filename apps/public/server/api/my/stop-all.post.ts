// Stop all prayer reminders on every site the person prays with. With
// `emails`, also every marketing email, News from Prayer.Tools included.
import { unsubscribeEverywhere } from '@prayertools/shared/unsubscribe-all'
import { useDb } from '../../utils/db'
import { clientIp, limit, requestHost } from '../../utils/request'
import { requireSessionUser } from '../../utils/account-session'
import { staffOrgId } from '../../utils/staff'

export default defineEventHandler(async (event) => {
  limit(event, 'my-stop-all', 5, 60_000)
  const userId = await requireSessionUser(event)
  const { emails } = await readBody<{ emails?: boolean }>(event) ?? {}
  await unsubscribeEverywhere(useDb(), userId, {
    newsOrgId: await staffOrgId(),
    remindersOnly: !emails,
    capture: { wording: { key: 'my.stop_all' }, surface: 'my_prayer', source: requestHost(event), ip: clientIp(event), userAgent: getRequestHeader(event, 'user-agent') ?? null }
  })
  return { ok: true }
})
