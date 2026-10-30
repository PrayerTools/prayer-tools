// Accepts an invitation from Your sites. The invite must be addressed to the
// signed-in user's verified email; it grants its sites like the emailed link.
import { requireAuth } from '#core/server/utils/auth'
import { db } from '#core/server/utils/database'
import { acceptInvite, emitAcceptedMemberships, emitInviteAccepted } from '#core/server/utils/invites'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const id = getRouterParam(event, 'id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) ptNotFound('Invitation not found.')
  const me = await db.selectFrom('users').select(['email', 'verified']).where('id', '=', user.userId).executeTakeFirstOrThrow()
  const invite = await db.selectFrom('invites').select(['id', 'email', 'invited_by']).where('id', '=', id).executeTakeFirst()
  if (!invite || !me.verified || !me.email || invite.email?.toLowerCase() !== me.email.toLowerCase()) ptNotFound('Invitation not found.')
  const memberships = await db.transaction().execute(trx => acceptInvite(trx, invite.id, user.userId))
  await emitAcceptedMemberships(memberships, user.userId, invite.invited_by)
  await emitInviteAccepted(invite.id, user.userId, invite.invited_by)
  const first = memberships[0] ? await db.selectFrom('orgs').select('slug').where('id', '=', memberships[0].orgId).executeTakeFirst() : null
  return { slug: first?.slug ?? null }
})
