// Records a check-in (token stored hashed) and sends it in one org transaction, so a failed send leaves no row.
import { withOrg } from '@prayertools/shared/db/scope'
import { primaryEmailOf } from '@prayertools/shared/crm'
import { isSuppressed } from '@prayertools/shared/email/suppression'
import { logEmails } from '@prayertools/shared/email/log'
import { checkinEmail, loadSiteMailContext } from '@prayertools/shared/email/templates'
import type { CheckinKind } from '@prayertools/shared/db/schema'
import { hashToken, randomToken } from '@prayertools/shared/tokens'
import { personLanguage, personLinks, siteMail, siteRow } from '../mail'
import { JobError, requireString, type JobContext } from './registry'

const KINDS: CheckinKind[] = ['checkin', 'reminder', 'manual']

export function checkinUrls(siteUrl: string, token: string) {
  return {
    yes: `${siteUrl}/checkin/${token}/yes`,
    sometimes: `${siteUrl}/checkin/${token}/sometimes`,
    no: `${siteUrl}/checkin/${token}/no`
  }
}

export async function checkinEmailJob(ctx: JobContext, payload: Record<string, unknown>) {
  const subscriptionId = requireString(payload, 'subscriptionId')
  const kind = payload.kind as CheckinKind
  if (!KINDS.includes(kind)) throw new JobError(`Unknown check-in kind ${String(kind)}`, false)
  const orgId = ctx.job.org_id
  if (!orgId) throw new JobError('org_id is required', false)
  if ((await ctx.progress<{ sent: boolean }>()).sent) return { already: true }

  return await withOrg(ctx.app, orgId, async (tx) => {
    const sub = await tx.selectFrom('pt_subscription').selectAll().where('id', '=', subscriptionId).executeTakeFirst()
    if (!sub || sub.anonymized_at || sub.delivery !== 'email' || !sub.verified_at) return { skipped: 'not_eligible' }
    // Automatic check-ins go only to active people; a manual one may reach
    // an inactive person, never an unsubscribed one.
    if (kind === 'manual' ? sub.status === 'unsubscribed' : sub.status !== 'active') return { skipped: 'status' }
    const email = sub.contact_id ? await primaryEmailOf(tx, sub.contact_id) : null
    if (!email) return { skipped: 'no_email' }
    if (await isSuppressed(tx, email.email)) return { skipped: 'suppressed' }
    const site = await siteRow(tx)
    if (!site) return { skipped: 'no_site' }

    const token = randomToken(24)
    const row = await tx
      .insertInto('pt_checkin')
      .values({ subscription_id: sub.id, kind, token_hash: hashToken(token), sent_at: ctx.now() })
      .returning('id')
      .executeTakeFirstOrThrow()
    const mctx = await loadSiteMailContext(tx, orgId)
    const lang = personLanguage(sub.language, site)
    const links = personLinks(mctx, sub)
    const rendered = checkinEmail(mctx, lang, { ...checkinUrls(mctx.siteUrl, token), ...links }, { reminder: kind === 'reminder' })
    await ctx.sendMail(siteMail(mctx, email.email, rendered, 'checkin', links.unsubscribeUrl))
    await logEmails(tx, [{ subscriptionId: sub.id, kind: 'checkin', subject: rendered.subject, sentAt: ctx.now() }])
    await ctx.saveProgress({ sent: true, checkin_id: row.id })
    return { checkin_id: row.id }
  })
}
