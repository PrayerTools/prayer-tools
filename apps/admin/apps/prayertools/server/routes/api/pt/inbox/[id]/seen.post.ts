// Opening a conversation clears its inbox notifications for the whole team,
// so a message one person has read stops showing in everyone's bell and digest.
import { sql } from 'kysely'

export default definePtHandler('inbox.access', async (event, tx) => {
  const id = getRouterParam(event, 'id')!
  const result = await tx
    .updateTable('notifications')
    .set({ read_at: sql<Date>`now()` })
    .where('app_id', '=', 'inbox')
    .where('link', '=', `/inbox/${id}`)
    .where('read_at', 'is', null)
    .executeTakeFirst()
  return { updated: Number(result.numUpdatedRows) }
})
