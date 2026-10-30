// "Email me my link": always the same answer; a link is sent only when an
// account with that address exists. `continue` is where to go once signed in
// (a hand-off to a site or the admin app).
import { normalizeEmail } from '@prayertools/shared/crm'
import { accountByEmail } from '@prayertools/shared/accounts'
import { issueAuthCode, safeReturnPath, SIGN_IN_MINUTES } from '@prayertools/shared/auth-codes'
import { myPrayerEmail } from '@prayertools/shared/email/templates'
import { sendMail } from '@prayertools/shared/email/transport'
import { isSuppressed } from '@prayertools/shared/email/suppression'
import { platformOrigin } from '@prayertools/shared/config'
import { useDb } from '../../utils/db'
import { background, limit, readJson, str } from '../../utils/request'
import { UI_LANGUAGES } from '../../utils/site-data'

export default defineEventHandler(async (event) => {
  limit(event, 'my-link', 5, 60_000)
  limit(event, 'my-link-hour', 20, 3_600_000)
  const body = await readJson(event)
  const { normalized, valid } = normalizeEmail(str(body.email, 254))
  const lang = UI_LANGUAGES.includes(str(body.language, 10)) ? str(body.language, 10) : 'en'
  const next = safeReturnPath(body.continue, '/my')
  if (valid) {
    const db = useDb()
    const account = await accountByEmail(db, normalized)
    if (account?.email && !(await isSuppressed(db, account.email))) {
      const code = await issueAuthCode(db, { userId: account.id, purpose: 'sign_in', ttlMs: SIGN_IN_MINUTES * 60_000, returnTo: next.startsWith('/my') ? next : '/my' })
      const mail = myPrayerEmail(lang, `${platformOrigin()}/my/login/${code}`, 0, SIGN_IN_MINUTES)
      background(event, sendMail({ stream: 'transactional', to: account.email, fromName: 'Prayer.Tools', fromLocal: 'my', subject: mail.subject, html: mail.html, text: mail.text, tags: ['my_link'] }))
    }
  }
  return { ok: true }
})
