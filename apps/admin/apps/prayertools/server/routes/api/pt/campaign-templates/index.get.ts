// The caller's own campaign templates and those shared with them, for the
// library and for New campaign. `role` is owner, editor or viewer.
import { withUserContext } from '#core/server/utils/personal-apps'
import { PT_LIBRARY_APP } from '@prayertools/shared/site'

export default defineEventHandler(async (event) => {
  const user = await ptUser(event)
  const rows = await withUserContext(event, { appId: PT_LIBRARY_APP }, tx => ptTx(tx).selectFrom('pt_personal_template as t')
    .innerJoin('users as u', 'u.id', 't.owner_user_id')
    .leftJoin('pt_personal_template_shares as s', join => join.onRef('s.resource_id', '=', 't.id').on('s.grantee_user_id', '=', user.userId))
    .select(['t.id', 't.owner_user_id', 't.name', 't.template_key', 't.setup', 't.library_ids', 't.updated_at', 'u.display_name as owner_name', 's.role'])
    .where(eb => eb.or([eb('t.owner_user_id', '=', user.userId), eb('s.id', 'is not', null)]))
    .orderBy('t.name').execute())
  return { templates: rows.map(({ library_ids, ...r }) => ({ ...r, libraries: library_ids.length, role: ptItemRole(r.owner_user_id, r.role, user.userId) })) }
})
