import { withMySubscription } from '../../../../utils/my'
import { updateProfile } from '../../../../utils/sub-actions'
import { limit, readJson } from '../../../../utils/request'

export default defineEventHandler(async (event) => {
  limit(event, 'my', 60, 60_000)
  const body = await readJson(event)
  await withMySubscription(event, async (tx, sub) => {
    const site = await tx.selectFrom('pt_site').select('languages').executeTakeFirstOrThrow()
    await updateProfile(tx, sub, body, site.languages)
  })
  return { ok: true }
})
