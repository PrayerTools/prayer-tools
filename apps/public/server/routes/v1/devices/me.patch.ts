import { isValidTimezone } from '@prayertools/shared/dates'
import { useDb } from '../../../utils/db'
import { readJson, str } from '../../../utils/request'
import { requireDevice } from '../../../utils/app-api'

export default defineEventHandler(async (event) => {
  const device = await requireDevice(event)
  const body = await readJson(event, 4096)
  const patch: Record<string, string | Date | null> = { last_seen_at: new Date() }
  if ('timezone' in body) {
    const tz = str(body.timezone, 64)
    if (tz && !isValidTimezone(tz)) throw createError({ statusCode: 400, statusMessage: 'timezone' })
    patch.timezone = tz || null
  }
  if ('language' in body) patch.language = str(body.language, 10) || null
  if ('push_id' in body) patch.push_id = str(body.push_id, 400) || null
  if ('app_version' in body) patch.app_version = str(body.app_version, 40) || null
  if ('platform' in body) patch.platform = str(body.platform, 20) || null
  await useDb().updateTable('pt_user_device').set(patch).where('id', '=', device.deviceId).execute()
  return { ok: true }
})
