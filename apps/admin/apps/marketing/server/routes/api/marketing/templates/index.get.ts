// The user's personal template library, usable on any of their sites: their
// own templates and those shared with them. `role` is owner, editor or viewer.
export default defineMarketingUserHandler(async (_event, tx, userId) => {
  const rows = await tx
    .selectFrom('marketing_template as t')
    .innerJoin('users as u', 'u.id', 't.owner_user_id')
    .leftJoin('marketing_template_shares as s', join => join.onRef('s.resource_id', '=', 't.id').on('s.grantee_user_id', '=', userId))
    .select(['t.id', 't.name', 't.versions', 't.source_language', 't.created_at', 't.updated_at', 't.owner_user_id', 'u.display_name as owner_name', 's.role'])
    .where(eb => eb.or([eb('t.owner_user_id', '=', userId), eb('s.id', 'is not', null)]))
    .orderBy('t.updated_at', 'desc')
    .execute()
  const templates = rows.map(({ owner_user_id, role, ...t }) => ({ ...t, role: owner_user_id === userId ? 'owner' as const : role! }))
  return { templates }
})
