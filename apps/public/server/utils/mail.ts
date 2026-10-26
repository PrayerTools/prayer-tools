// Site email: rendered inside the org transaction, delivered after it, never
// to a globally suppressed address. Mail to a subscriber is logged once sent.
import { withOrg, type Tx } from '@prayertools/shared/db/scope'
import { loadSiteMailContext, type Rendered, type SiteMailContext } from '@prayertools/shared/email/templates'
import { isSuppressed } from '@prayertools/shared/email/suppression'
import { sendMail } from '@prayertools/shared/email/transport'
import { logEmails } from '@prayertools/shared/email/log'
import { useDb } from './db'

export interface PendingMail {
  ctx: SiteMailContext
  to: string
  rendered: Rendered
  kind: string
  subscriptionId: string | null
}

export async function prepareSiteMail(tx: Tx, orgId: string, to: string, kind: string, render: (ctx: SiteMailContext) => Rendered, subscriptionId: string | null = null): Promise<PendingMail | null> {
  if (await isSuppressed(tx, to)) return null
  const ctx = await loadSiteMailContext(tx, orgId)
  return { ctx, to, rendered: render(ctx), kind, subscriptionId }
}

export async function deliver(mail: PendingMail | null): Promise<void> {
  if (!mail) return
  await sendMail({
    stream: 'transactional',
    to: mail.to,
    fromName: mail.ctx.fromName,
    fromLocal: mail.ctx.fromLocal,
    replyTo: mail.ctx.replyTo,
    subject: mail.rendered.subject,
    html: mail.rendered.html,
    text: mail.rendered.text,
    meta: { org_id: mail.ctx.orgId, kind: mail.kind },
    tags: [mail.kind]
  })
  const subscriptionId = mail.subscriptionId
  if (subscriptionId) await withOrg(useDb(), mail.ctx.orgId, tx => logEmails(tx, [{ subscriptionId, kind: mail.kind, subject: mail.rendered.subject }]))
}
