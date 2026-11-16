// The platform libraries, with how many drafts differ from the published text.
import { sql } from 'kysely'

export default defineEventHandler(async (event) => {
  await ptRequireLibraryOperator(event)
  const libraries = await ptAdminDb().selectFrom('pt_library as l')
    .select(['l.id', 'l.key', 'l.title', 'l.cadence', 'l.languages', 'l.entry_count', 'l.published_version', 'l.published_at', 'l.updated_at'])
    .select(sql<number>`(SELECT count(*)::int FROM pt_library_entry e WHERE e.library_id = l.id AND (e.published IS NULL OR e.draft <> e.published))`.as('drafts'))
    .where('l.owner_user_id', 'is', null).orderBy('l.title').execute()
  return { libraries }
})
