import { withManaged } from '../../utils/manage'
import { updateProfile } from '../../utils/sub-actions'
import { limit, readJson } from '../../utils/request'

export default defineEventHandler(async (event) => {
  limit(event, 'manage', 60, 60_000)
  const body = await readJson(event)
  await withManaged(event, async (tx, sub) => {
    const site = await tx.selectFrom('pt_site').select('languages').executeTakeFirstOrThrow()
    await updateProfile(tx, sub, body, site.languages)
  })
  return { ok: true }
})
