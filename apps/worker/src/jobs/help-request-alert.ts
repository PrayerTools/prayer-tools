// Tells every Prayer.Tools operator, in English, that a site asked for help on
// an inbox conversation. The email names the site, who asked and their note,
// never the conversation's content or the person who wrote in.
import { platformConfig, platformOrigin } from '@prayertools/shared/config'
import { button, layout, paragraph, type Rendered, type SiteMailContext } from '@prayertools/shared/email/templates'
import { escapeHtml } from '@prayertools/shared/tiptap'
import { PT_STREAMS } from '@prayertools/shared/email/mail'
import { requireString, type JobContext } from './registry'

export function helpRequestEmail(d: { siteName: string, siteSlug: string, askedBy: string, note: string }): Rendered {
  const ctx: SiteMailContext = {
    orgId: '', slug: '', siteName: 'Prayer.Tools', siteUrl: platformOrigin(), color: '#2f6f5e', textOnColor: '#ffffff',
    logoUrl: null, fromName: 'Prayer.Tools', fromLocal: 'noreply', replyTo: null, signature: {}, defaultLanguage: 'en'
  }
  const url = `${platformConfig().adminUrl}/admin/pt/help-requests`
  const intro = `${d.askedBy} on ${d.siteName} (${d.siteSlug}) asked Prayer.Tools for help with an inbox conversation.`
  const body = `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">${escapeHtml(d.siteName)} asked for help</h1>`
    + paragraph(intro)
    + paragraph(`Their note: ${d.note}`)
    + button(ctx, url, 'Open help requests')
  return {
    subject: `Help request from ${d.siteName}`,
    html: layout(ctx, 'en', body, { reason: 'You are receiving this because you are a Prayer.Tools operator.', hideMy: true }),
    text: `${intro}\n\nTheir note: ${d.note}\n\nOpen help requests: ${url}`
  }
}

export async function helpRequestAlertJob(ctx: JobContext, payload: Record<string, unknown>) {
  const requestId = requireString(payload, 'requestId')
  const request = await ctx.admin.selectFrom('pt_help_request as h')
    .innerJoin('orgs as o', 'o.id', 'h.org_id')
    .leftJoin('users as u', 'u.id', 'h.requested_by')
    .select(['h.note', 'h.org_id', 'o.name', 'o.slug', 'u.display_name', 'u.email'])
    .where('h.id', '=', requestId).executeTakeFirst()
  if (!request) return { skipped: 'no_request' }
  const operators = await ctx.admin.selectFrom('users').select('email')
    .where('is_admin', '=', true).where('email', 'is not', null)
    .$narrowType<{ email: string }>().execute()
  const progress = await ctx.progress<{ sent: string[] }>()
  const sent = new Set(progress.sent ?? [])
  const rendered = helpRequestEmail({ siteName: request.name, siteSlug: request.slug, askedBy: request.display_name || request.email || 'A team member', note: request.note })
  for (const { email } of operators) {
    if (sent.has(email)) continue
    await ctx.sendMail({ stream: PT_STREAMS.platform.id, orgId: request.org_id, to: email, fromName: 'Prayer.Tools', fromLocal: 'noreply', subject: rendered.subject, html: rendered.html, text: rendered.text })
    sent.add(email)
    await ctx.saveProgress({ sent: [...sent] })
  }
  return { recipients: operators.length }
}
