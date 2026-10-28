// Tells a site's admins, in English, that their custom domain no longer points to prayer.tools.
import { sql } from 'kysely'
import { platformConfig, platformOrigin } from '@prayertools/shared/config'
import { button, layout, paragraph, type Rendered, type SiteMailContext } from '@prayertools/shared/email/templates'
import { subdomainUrl } from '@prayertools/shared/site'
import { escapeHtml } from '@prayertools/shared/tiptap'
import { JobError, requireString, type JobContext } from './registry'

export function domainAlertEmail(siteName: string, domain: string, fallbackUrl: string): Rendered {
  const ctx: SiteMailContext = {
    orgId: '', slug: '', siteName: 'Prayer.Tools', siteUrl: platformOrigin(), color: '#2f6f5e', textOnColor: '#ffffff',
    logoUrl: null, fromName: 'Prayer.Tools', fromLocal: 'noreply', replyTo: null, signature: {}, defaultLanguage: 'en'
  }
  const target = platformConfig().cloudflare.fallbackOrigin
  const lines = [
    `Your custom domain ${domain} for ${siteName} no longer points to Prayer.Tools.`,
    `Until it is fixed, your site stays reachable at ${fallbackUrl}, and links in reminder and site emails use that address.`,
    `To fix it, make sure ${domain} has a CNAME record pointing to ${target}. The domain becomes active again automatically once it resolves.`
  ]
  const adminUrl = platformConfig().adminUrl
  const body = `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">${escapeHtml(domain)} is not pointing to Prayer.Tools</h1>`
    + lines.map(paragraph).join('')
    + button(ctx, adminUrl, 'Open your site settings')
  return {
    subject: `Your domain ${domain} is not pointing to Prayer.Tools`,
    html: layout(ctx, 'en', body, { reason: `You are receiving this because you manage ${siteName} on Prayer.Tools.` }),
    text: `${lines.join('\n\n')}\n\nOpen your site settings: ${adminUrl}`
  }
}

export async function domainAlertJob(ctx: JobContext, payload: Record<string, unknown>) {
  const domain = requireString(payload, 'domain')
  const orgId = (payload.orgId as string | undefined) ?? ctx.job.org_id
  if (!orgId) throw new JobError('orgId is required', false)
  if ((payload.state ?? 'failing') !== 'failing') return { skipped: 'state' }
  const org = await ctx.admin.selectFrom('orgs').select(['slug', 'name']).where('id', '=', orgId).executeTakeFirst()
  if (!org) return { skipped: 'no_site' }
  const owners = await ctx.admin
    .selectFrom('memberships as m')
    .innerJoin('users as u', 'u.id', 'm.user_id')
    .select('u.email')
    .where('m.org_id', '=', orgId)
    .where(sql<boolean>`m.roles && ARRAY['admin', 'owner']::text[]`)
    .where('u.email', 'is not', null)
    .$narrowType<{ email: string }>()
    .execute()
  const progress = await ctx.progress<{ sent: string[] }>()
  const sent = new Set(progress.sent ?? [])
  const rendered = domainAlertEmail(org.name, domain, subdomainUrl(org.slug))
  for (const { email } of owners) {
    if (sent.has(email)) continue
    await ctx.sendMail({ stream: 'transactional', to: email, fromName: 'Prayer.Tools', fromLocal: 'noreply', subject: rendered.subject, html: rendered.html, text: rendered.text, meta: { org_id: orgId, kind: 'domain_alert' }, tags: ['domain_alert'] })
    sent.add(email)
    await ctx.saveProgress({ sent: [...sent] })
  }
  return { recipients: owners.length }
}
