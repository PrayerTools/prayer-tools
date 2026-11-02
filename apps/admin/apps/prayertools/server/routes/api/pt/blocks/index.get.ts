// Reusable content blocks in the champion's personal library: their own and
// those shared with them. `role` is owner, editor or viewer.
import { withUserContext } from '#core/server/utils/personal-apps'
import { PT_LIBRARY_APP } from '@prayertools/shared/site'

export default defineEventHandler(async (event) => {
  const user = await ptUser(event)
  const rows = await withUserContext(event, { appId: PT_LIBRARY_APP }, tx => ptTx(tx).selectFrom('pt_personal_block as b')
    .innerJoin('users as u', 'u.id', 'b.owner_user_id')
    .leftJoin('pt_personal_block_shares as s', join => join.onRef('s.resource_id', '=', 'b.id').on('s.grantee_user_id', '=', user.userId))
    .selectAll('b')
    .select(['u.display_name as owner_name', 's.role'])
    .where(eb => eb.or([eb('b.owner_user_id', '=', user.userId), eb('s.id', 'is not', null)]))
    .orderBy('b.name').execute())
  return { blocks: rows.map(r => ({ ...r, role: ptItemRole(r.owner_user_id, r.role, user.userId) })) }
})
