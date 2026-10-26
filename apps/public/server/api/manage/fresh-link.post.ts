// "Send me a fresh link" from an expired manage link. Always answers the same
// way; mails the subscription's own address only.
import { withOrg } from '@prayertools/shared/db/scope'
import { verifySignedJson } from '@prayertools/shared/tokens'
import { platformConfig } from '@prayertools/shared/config'
import { primaryEmailOf } from '@prayertools/shared/crm'
import { manageLinkEmail } from '@prayertools/shared/email/templates'
import { manageUrl } from '@prayertools/shared/links'
import { useDb } from '../../utils/db'
import { background, limit, readJson, str } from '../../utils/request'
import { siteContext } from '../../utils/site-context'
import { deliver, prepareSiteMail } from '../../utils/mail'

export default defineEventHandler(async (event) => {
  const ctx = siteContext(event)
  limit(event, 'fresh-link', 5, 60_000)
  const body = await readJson(event)
  // Signature checked, expiry and version deliberately not: the point is to
  // replace a link that is too old.
  const p = verifySignedJson<{ t: string, s: string, o: string }>(str(body.token, 2000), platformConfig().secret)
  if (p && (p.t === 'm' || p.t === 'u') && p.o === ctx.orgId) {
    const mail = await withOrg(useDb(), ctx.orgId, async (tx) => {
      const sub = await tx.selectFrom('pt_subscription').selectAll().where('id', '=', p.s).executeTakeFirst()
      if (!sub?.contact_id || sub.anonymized_at) return null
      const email = await primaryEmailOf(tx, sub.contact_id)
      if (!email) return null
      return await prepareSiteMail(tx, ctx.orgId, email.email, 'manage_link', m => manageLinkEmail(m, sub.language, manageUrl(m.siteUrl, ctx.orgId, sub.id, sub.manage_version)), sub.id)
    })
    background(event, deliver(mail))
  }
  return { ok: true }
})
