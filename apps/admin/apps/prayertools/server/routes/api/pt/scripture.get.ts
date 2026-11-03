// Scripture lookup through bolls.life: "John 3:16-18" in a translation
// (default NIV). Returns plain verse text for the editor's Scripture block.
import { requireAuth } from '#core/server/utils/auth'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const q = getQuery(event)
  return await ptLookupScripture(String(q.ref ?? ''), ptBibleTranslation(q.translation))
})
