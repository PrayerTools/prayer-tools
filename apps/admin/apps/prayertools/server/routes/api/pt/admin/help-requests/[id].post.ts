// Marks a help request handled, with an optional reply to the team member who asked.
import { requireOperatorAdmin } from '#tenant/server'
import { db } from '#core/server/utils/database'
import { withOrg } from '@prayertools/shared/db/scope'
import { handleHelpRequest } from '@prayertools/shared/help-requests'

export default defineEventHandler(async (event) => {
  const { userId } = await requireOperatorAdmin(event)
  const { reply } = await ptBody<{ reply?: unknown }>(event)
  const id = getRouterParam(event, 'id')!
  const request = /^[0-9a-f-]{36}$/i.test(id)
    ? await ptAdminDb().selectFrom('pt_help_request').select('org_id').where('id', '=', id).executeTakeFirst()
    : undefined
  if (!request) ptNotFound('Help request not found.')
  await ptHelpRequestCall(() => withOrg(ptAppDb(db), request.org_id, tx =>
    handleHelpRequest(tx, { orgId: request.org_id, requestId: id, operatorId: userId, reply }, ptLogOnConversation)))
  return { ok: true }
})
