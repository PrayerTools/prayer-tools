import { syncAccountEverywhere, withMySubscription } from '../../../../utils/my'
import { updateProfile } from '../../../../utils/sub-actions'
import { background, limit, readJson } from '../../../../utils/request'

export default defineEventHandler(async (event) => {
  limit(event, 'my', 60, 60_000)
  const body = await readJson(event)
  const renamed = await withMySubscription(event, async (tx, sub) => {
    const site = await tx.selectFrom('pt_site').select('languages').executeTakeFirstOrThrow()
    return await updateProfile(tx, sub, body, site.languages)
  })
  if (renamed) background(event, syncAccountEverywhere(renamed))
  return { ok: true }
})
