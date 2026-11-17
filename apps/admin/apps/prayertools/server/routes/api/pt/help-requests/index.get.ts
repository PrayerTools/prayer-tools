// The conversation's open help request, if one was sent and not yet answered.
import { withOrgContext } from '#tenant/server'
import { HELP_NOTE_MAX, HELP_REQUEST_PERMISSION, openHelpRequest } from '@prayertools/shared/help-requests'

export default defineEventHandler(async (event) => {
  const conversationId = String(getQuery(event).conversationId ?? '')
  return await withOrgContext(event, { appId: 'inbox' }, async (tx, ctx) => {
    ptNeed(ctx, HELP_REQUEST_PERMISSION)
    return { open: await openHelpRequest(ptTx(tx), conversationId), noteMax: HELP_NOTE_MAX }
  })
})
