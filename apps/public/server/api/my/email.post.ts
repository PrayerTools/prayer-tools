// The person asks to change their address: a confirmation link goes to the
// new one, and nothing changes until it is opened. It needs a sign-in from
// the last few minutes, so a stolen long-lived session can't move the account. The current address is
// told, with a link that keeps it. An address another account already uses
// gets no link; the answer is the same either way.
import { normalizeEmail } from '@prayertools/shared/crm'
import { accountByEmail, accountById } from '@prayertools/shared/accounts'
import { EMAIL_CHANGE_MINUTES, EMAIL_UNDO_DAYS, issueAuthCode } from '@prayertools/shared/auth-codes'
import { emailChangeEmail, emailChangeNoticeEmail } from '@prayertools/shared/email/templates'
import { sendMail } from '@prayertools/shared/email/transport'
import { isSuppressed } from '@prayertools/shared/email/suppression'
import { platformOrigin } from '@prayertools/shared/config'
import { useDb } from '../../utils/db'
import { background, limit, readJson, str } from '../../utils/request'
import { UI_LANGUAGES } from '../../utils/site-data'
import { requireSessionUser } from '../../utils/account-session'
import { EMAIL_CHANGE_SIGN_IN_MINUTES, signedInWithin } from '../../utils/account-links'

export default defineEventHandler(async (event) => {
  limit(event, 'my-email', 5, 3_600_000)
  const userId = await requireSessionUser(event)
  if (!(await signedInWithin(event, EMAIL_CHANGE_SIGN_IN_MINUTES * 60_000))) {
    throw createError({ statusCode: 403, statusMessage: 'Sign in again', data: { reauth: true } })
  }
  const body = await readJson(event)
  const { normalized, valid } = normalizeEmail(str(body.email, 254))
  if (!valid) throw createError({ statusCode: 400, statusMessage: 'email' })
  const lang = UI_LANGUAGES.includes(str(body.language, 10)) ? str(body.language, 10) : 'en'
  const db = useDb()
  const holder = await accountByEmail(db, normalized)
  if (!holder && !(await isSuppressed(db, normalized))) {
    const code = await issueAuthCode(db, { userId, purpose: 'email_change', email: normalized, ttlMs: EMAIL_CHANGE_MINUTES * 60_000 })
    const mail = emailChangeEmail(lang, `${platformOrigin()}/my/email/${code}`, EMAIL_CHANGE_MINUTES)
    background(event, sendMail({ stream: 'transactional', to: normalized, fromName: 'Prayer.Tools', fromLocal: 'my', subject: mail.subject, html: mail.html, text: mail.text, tags: ['email_change'] }))
    const current = (await accountById(db, userId))?.email
    if (current && current !== normalized) {
      const undo = await issueAuthCode(db, { userId, purpose: 'email_undo', email: current, ttlMs: EMAIL_UNDO_DAYS * 86_400_000 })
      const notice = emailChangeNoticeEmail(lang, `${platformOrigin()}/my/email-undo/${undo}`, normalized, EMAIL_UNDO_DAYS)
      background(event, sendMail({ stream: 'transactional', to: current, fromName: 'Prayer.Tools', fromLocal: 'my', subject: notice.subject, html: notice.html, text: notice.text, tags: ['email_change_notice'] }))
    }
  }
  return { ok: true }
})
