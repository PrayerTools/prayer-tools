// Site email: rendered inside the org transaction, delivered after it, never
// to a globally suppressed address.
import type { Tx } from '@prayertools/shared/db/scope'
import { loadSiteMailContext, type Rendered, type SiteMailContext } from '@prayertools/shared/email/templates'
import { isSuppressed } from '@prayertools/shared/email/suppression'
import { sendMail } from '@prayertools/shared/email/transport'

export interface PendingMail {
  ctx: SiteMailContext
  to: string
  rendered: Rendered
  kind: string
  unsubscribeUrl?: string | null
}

export async function prepareSiteMail(tx: Tx, orgId: string, to: string, kind: string, render: (ctx: SiteMailContext) => Rendered): Promise<PendingMail | null> {
  if (await isSuppressed(tx, to)) return null
  const ctx = await loadSiteMailContext(tx, orgId)
  return { ctx, to, rendered: render(ctx), kind }
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
    unsubscribeUrl: mail.unsubscribeUrl,
    meta: { org_id: mail.ctx.orgId, kind: mail.kind },
    tags: [mail.kind]
  })
}
