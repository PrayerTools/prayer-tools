// Whether AI translate buttons should show in library editing (outside any site): the host has AI set up.
import { db } from '#core/server/utils/database'

export default defineEventHandler(async (event) => {
  await ptUser(event)
  return { available: await db.transaction().execute(tx => ptTranslateAvailable(tx)) }
})
