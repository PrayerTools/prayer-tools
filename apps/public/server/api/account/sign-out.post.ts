// Signs this browser out on this site's host, including the manage cookie
// that opens the person's prayer times here.
import { endAccountSession } from '../../utils/account-session'
import { clearManageCookie } from '../../utils/cookies'

export default defineEventHandler(async (event) => {
  await endAccountSession(event)
  clearManageCookie(event)
  return { ok: true }
})
