// Sends an inbox conversation to Prayer.Tools with a note on what the team needs.
import { withOrgContext } from '#tenant/server'
import { askForHelp } from '@prayertools/shared/help-requests'

export default defineEventHandler(async (event) => {
  const body = await ptBody<{ conversationId?: unknown, note?: unknown }>(event)
  return await withOrgContext(event, { appId: 'inbox' }, (tx, ctx) => ptHelpRequestCall(() => askForHelp(ptTx(tx), {
    orgId: ctx.orgId,
    userId: ctx.userId,
    perms: ctx.perms,
    conversationId: String(body.conversationId ?? ''),
    note: body.note
  }, ptLogOnConversation)))
})
