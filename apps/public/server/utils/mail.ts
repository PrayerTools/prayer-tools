// Site email: rendered inside the org transaction, queued after it on the mail
// kernel's outbox for the worker to send. A link the person just asked for
// goes on the confirmations stream, which reaches even a suppressed address;
// other site mail skips one. Mail to a subscriber is logged with its queuing.
import { withOrg, type Tx } from '@prayertools/shared/db/scope'
import { loadSiteMailContext, type Rendered, type SiteMailContext } from '@prayertools/shared/email/templates'
import { isSuppressed } from '@prayertools/shared/email/suppression'
import { enqueuePtMail, PT_STREAMS } from '@prayertools/shared/email/mail'
import { logEmails } from '@prayertools/shared/email/log'
import { useDb } from './db'

// Kinds that answer the person's own request.
const CONFIRMATIONS = new Set(['verify', 'manage_link', 'add_times', 'notify_confirm'])

export interface PendingMail {
  ctx: SiteMailContext
  to: string
  rendered: Rendered
  kind: string
  subscriptionId: string | null
  unsubscribeUrl?: string | null
}

export async function prepareSiteMail(tx: Tx, orgId: string, to: string, kind: string, render: (ctx: SiteMailContext) => Rendered, subscriptionId: string | null = null): Promise<PendingMail | null> {
  if (!CONFIRMATIONS.has(kind) && await isSuppressed(tx, to, orgId)) return null
  const ctx = await loadSiteMailContext(tx, orgId)
  return { ctx, to, rendered: render(ctx), kind, subscriptionId }
}

export async function deliver(mail: PendingMail | null): Promise<void> {
  if (!mail) return
  await withOrg(useDb(), mail.ctx.orgId, async (tx) => {
    await enqueuePtMail(tx, {
      stream: CONFIRMATIONS.has(mail.kind) ? PT_STREAMS.confirmations.id : PT_STREAMS.site.id,
      orgId: mail.ctx.orgId,
      to: mail.to,
      fromName: mail.ctx.fromName,
      fromLocal: mail.ctx.fromLocal,
      replyTo: mail.ctx.replyTo ?? undefined,
      subject: mail.rendered.subject,
      html: mail.rendered.html,
      text: mail.rendered.text,
      unsubscribeUrl: mail.unsubscribeUrl ?? undefined
    })
    if (mail.subscriptionId) await logEmails(tx, [{ subscriptionId: mail.subscriptionId, kind: mail.kind, subject: mail.rendered.subject }])
  })
}

// Prayer.Tools' own mail to an account (My prayer sign-in links, address
// changes), queued outside any site.
export async function queueAccountMail(m: { stream: 'confirmations' | 'platform', to: string, rendered: Rendered }): Promise<void> {
  await useDb().transaction().execute(tx => enqueuePtMail(tx, {
    stream: PT_STREAMS[m.stream].id,
    to: m.to,
    fromName: 'Prayer.Tools',
    fromLocal: 'my',
    subject: m.rendered.subject,
    html: m.rendered.html,
    text: m.rendered.text
  }))
}
