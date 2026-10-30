// Declines an invitation from Your sites: it is removed, so the link in the
// email stops working and the inviter no longer sees it pending. Only the
// signed-in user the invite is addressed to (verified email) may decline it.
import { requireAuth } from '#core/server/utils/auth'
import { db } from '#core/server/utils/database'
import { logEvent } from '#core/server/utils/activity-logger'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const id = getRouterParam(event, 'id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) ptNotFound('Invitation not found.')
  const me = await db.selectFrom('users').select(['email', 'verified']).where('id', '=', user.userId).executeTakeFirstOrThrow()
  if (!me.verified || !me.email) ptNotFound('Invitation not found.')
  const email = me.email
  const res = await db
    .deleteFrom('invites')
    .where('id', '=', id)
    .where('accepted_at', 'is', null)
    .where(eb => eb(eb.fn('lower', ['email']), '=', email.toLowerCase()))
    .executeTakeFirst()
  if (!Number(res.numDeletedRows)) ptNotFound('Invitation not found.')
  await logEvent({ eventType: 'invite_declined', tableName: 'invites', recordId: id, userId: user.userId }).catch(() => {})
  return { ok: true }
})
