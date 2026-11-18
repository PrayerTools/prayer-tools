// Emails the person a sign-in link to My prayer, where they change their own
// name and email address. It goes to the address on their account.
import { platformOrigin } from '@prayertools/shared/config'
import { accountById } from '@prayertools/shared/accounts'
import { issueAuthCode, TEAM_SIGN_IN_HOURS } from '@prayertools/shared/auth-codes'
import { myPrayerEmail } from '@prayertools/shared/email/templates'
import { assertMailable, enqueueMail } from '#core/server/utils/mail'
import { PT_STREAMS } from '@prayertools/shared/email/mail'

export default definePtHandler('pt.intercessors.write', async (event, tx) => {
  const id = getRouterParam(event, 'id')!
  const sub = await tx.selectFrom('pt_subscription').select(['user_id', 'language']).where('id', '=', id).executeTakeFirst()
  if (!sub) ptNotFound('Intercessor not found.')
  const account = sub.user_id ? await accountById(ptTx(tx), sub.user_id) : null
  if (!account?.email) ptBadRequest('This person has no account with a confirmed email address yet.')
  await assertMailable(account.email, 'sign-in link')
  const code = await issueAuthCode(ptTx(tx), { userId: account.id, purpose: 'sign_in', ttlMs: TEAM_SIGN_IN_HOURS * 3_600_000, returnTo: '/my' })
  const mail = myPrayerEmail(sub.language, `${platformOrigin()}/my/login/${code}`, TEAM_SIGN_IN_HOURS)
  await enqueueMail(tx, { stream: PT_STREAMS.platform.id, to: account.email, fromName: 'Prayer.Tools', fromLocal: 'my', subject: mail.subject, html: mail.html, text: mail.text })
  return { ok: true }
})
