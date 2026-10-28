import { endAccountSession } from '../../utils/account-session'

export default defineEventHandler(async (event) => {
  await endAccountSession(event)
  return { ok: true }
})
