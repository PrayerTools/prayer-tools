// Library catalog, "my libraries" and libraries shared with the caller. The
// catalog lists published libraries (platform and shared with everyone) plus
// the caller's own and those shared with them; filters by cadence, language,
// topic, template and text.
import { db } from '#core/server/utils/database'
import { sql } from 'kysely'

export default defineEventHandler(async (event) => {
  const user = await ptUser(event)
  const q = getQuery(event)
  const shared = await ptLibrariesSharedWith(user.userId)
  const sharedIds = [...shared.keys()]
  let query = db.selectFrom('pt_library').select([
    'id', 'owner_user_id', 'title', 'description', 'cadence', 'entry_count', 'languages', 'source_language', 'topics', 'template_keys', 'series', 'edition',
    'license', 'license_note', 'credit', 'visibility', 'share_status', 'published_version', 'published_at', 'updated_at'
  ])
  if (q.scope === 'mine') {
    query = query.where('owner_user_id', '=', user.userId)
  } else if (q.scope === 'shared') {
    if (!sharedIds.length) return { libraries: [] }
    query = query.where('id', 'in', sharedIds)
  } else if (q.scope === 'platform' && user.isAdmin) {
    query = query.where('owner_user_id', 'is', null)
  } else {
    query = query.where(eb => eb.or([
      eb('visibility', '=', 'published'),
      eb('owner_user_id', '=', user.userId),
      ...(sharedIds.length ? [eb('id', 'in', sharedIds)] : [])
    ])).where('published_version', '>', 0)
  }
  if (q.cadence === 'daily' || q.cadence === 'weekly') query = query.where('cadence', '=', q.cadence)
  if (typeof q.language === 'string' && q.language) query = query.where(sql<boolean>`${q.language} = ANY(languages)`)
  if (typeof q.topic === 'string' && q.topic) query = query.where(sql<boolean>`${q.topic} = ANY(topics)`)
  if (typeof q.q === 'string' && q.q.trim()) query = query.where(eb => eb.or([eb('title', 'ilike', `%${q.q}%`), eb('description', 'ilike', `%${q.q}%`)]))
  const rows = await query.orderBy('title').limit(200).execute()
  const template = typeof q.template === 'string' ? q.template : null
  const owners = await ptOwnerNames(rows.filter(r => shared.has(r.id)).map(r => r.owner_user_id!))
  const libraries = rows.map(r => ({
    ...r,
    suggested: !!template && r.template_keys.includes(template),
    mine: r.owner_user_id === user.userId,
    platform: r.owner_user_id === null,
    role: r.owner_user_id === user.userId ? 'owner' as const : (shared.get(r.id) ?? null),
    owner_name: r.owner_user_id ? owners.get(r.owner_user_id) ?? null : null
  }))
  if (template) libraries.sort((a, b) => Number(b.suggested) - Number(a.suggested))
  return { libraries }
})
