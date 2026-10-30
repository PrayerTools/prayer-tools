// A sign-in handed over from My prayer on the platform host: the one-time
// code (issued for this app's host) becomes a session here, then the person
// lands on the admin page they asked for. The session keeps the time of that
// sign-in, so it counts as recently authenticated only while the sign-in does.
import { db } from '#core/server/utils/database'
import { startSession } from '#core/server/utils/sessions'
import { logEvent } from '#core/server/utils/activity-logger'
import { platformConfig } from '@prayertools/shared/config'
import { safeReturnPath, takeAuthCode } from '@prayertools/shared/auth-codes'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const host = new URL(platformConfig().adminUrl).host.toLowerCase()
  const row = await takeAuthCode(ptAppDb(db), typeof q.code === 'string' ? q.code : '', 'handoff', host)
  if (!row) return sendRedirect(event, '/login', 302)
  const user = await db.selectFrom('users').select(['id', 'email', 'display_name']).where('id', '=', row.user_id).executeTakeFirst()
  if (!user) return sendRedirect(event, '/login', 302)
  await startSession(event, user, { authenticatedAt: row.authenticated_at ? new Date(row.authenticated_at) : undefined })
  logEvent({ eventType: 'LOGIN', userId: user.id, userAgent: getRequestHeader(event, 'user-agent') || undefined, metadata: { via: 'my_prayer' } })
  return sendRedirect(event, safeReturnPath(q.to), 302)
})
