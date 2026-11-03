// The champion's personal image library, usable on any of their sites: their
// own images and those shared with them. `role` is owner, editor or viewer.
import { withUserContext } from '#core/server/utils/personal-apps'
import { PT_LIBRARY_APP } from '@prayertools/shared/site'

export default defineEventHandler(async (event) => {
  const user = await ptUser(event)
  const rows = await withUserContext(event, { appId: PT_LIBRARY_APP }, tx => ptTx(tx).selectFrom('pt_personal_asset as a')
    .innerJoin('users as u', 'u.id', 'a.owner_user_id')
    .leftJoin('pt_personal_asset_shares as s', join => join.onRef('s.resource_id', '=', 'a.id').on('s.grantee_user_id', '=', user.userId))
    .selectAll('a')
    .select(['u.display_name as owner_name', 's.role'])
    .where(eb => eb.or([eb('a.owner_user_id', '=', user.userId), eb('s.id', 'is not', null)]))
    .orderBy('a.created_at', 'desc').limit(500).execute())
  return { assets: rows.map(r => ({ ...r, role: ptItemRole(r.owner_user_id, r.role, user.userId) })) }
})
