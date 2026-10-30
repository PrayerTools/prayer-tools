// Signs this browser out on this site's host.
import { endAccountSession } from '../../utils/account-session'

export default defineEventHandler(async (event) => {
  await endAccountSession(event)
  return { ok: true }
})
