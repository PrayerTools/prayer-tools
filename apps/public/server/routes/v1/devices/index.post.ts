// Anonymous device registration: creates an account with no email and a
// per-device credential, returned once and stored hashed. `intercessor_id`
// in the response is the account's id.
import { hashToken, randomToken } from '@prayertools/shared/tokens'
import { createAnonymousAccount } from '@prayertools/shared/accounts'
import { isValidTimezone } from '@prayertools/shared/dates'
import { useDb } from '../../../utils/db'
import { limit, readJson, str } from '../../../utils/request'

export default defineEventHandler(async (event) => {
  limit(event, 'v1-register', 10, 60_000)
  const body = await readJson(event, 4096)
  const credential = randomToken(32)
  const db = useDb()
  const result = await db.transaction().execute(async (tx) => {
    const userId = await createAnonymousAccount(tx)
    const tz = str(body.timezone, 64)
    const device = await tx.insertInto('pt_user_device').values({
      user_id: userId,
      credential_hash: hashToken(credential),
      platform: str(body.platform, 20) || null,
      app_version: str(body.app_version, 40) || null,
      push_id: str(body.push_id, 400) || null,
      timezone: isValidTimezone(tz) ? tz : null,
      language: str(body.language, 10) || null
    }).returning('id').executeTakeFirstOrThrow()
    return { device_id: device.id, intercessor_id: userId }
  })
  setResponseStatus(event, 201)
  return { ...result, credential }
})
