// Removes this device's credential (sign out / uninstall clean-up).
import { useDb } from '../../../utils/db'
import { requireDevice } from '../../../utils/app-api'

export default defineEventHandler(async (event) => {
  const device = await requireDevice(event)
  await useDb().deleteFrom('pt_user_device').where('id', '=', device.deviceId).execute()
  return { ok: true }
})
