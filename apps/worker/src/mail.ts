// Language choice, personal links and the envelope for site emails to intercessors.
import type { Tx } from '@prayertools/shared/db/scope'
import { PT_STREAMS, type OutgoingMail } from '@prayertools/shared/email/mail'
import type { Rendered, SiteMailContext } from '@prayertools/shared/email/templates'
import { manageUrl, unsubscribeUrl } from '@prayertools/shared/links'

export interface SiteRow {
  status: 'draft' | 'published' | 'archived'
  languages: string[]
  default_language: string
  settings: Record<string, unknown>
}

export async function siteRow(tx: Tx): Promise<SiteRow | null> {
  const row = await tx.selectFrom('pt_site').select(['status', 'languages', 'default_language', 'settings']).executeTakeFirst()
  return row ? { ...row, settings: (row.settings ?? {}) as Record<string, unknown> } : null
}

// The person's language when the site still offers it, else the site default.
export function personLanguage(language: string | null | undefined, site: Pick<SiteRow, 'languages' | 'default_language'>): string {
  return language && site.languages.includes(language) ? language : site.default_language
}

export function personLinks(ctx: SiteMailContext, sub: { id: string, manage_version: number }): { manageUrl: string, unsubscribeUrl: string } {
  return {
    manageUrl: manageUrl(ctx.siteUrl, ctx.orgId, sub.id, sub.manage_version),
    unsubscribeUrl: unsubscribeUrl(ctx.siteUrl, ctx.orgId, sub.id)
  }
}

// The site's mail to one intercessor, on the site stream.
export function siteMail(ctx: SiteMailContext, to: string, rendered: Rendered, unsubscribe: string | null): OutgoingMail {
  return {
    stream: PT_STREAMS.site.id,
    orgId: ctx.orgId,
    to,
    fromName: ctx.fromName,
    fromLocal: ctx.fromLocal,
    replyTo: ctx.replyTo ?? undefined,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    unsubscribeUrl: unsubscribe ?? undefined
  }
}
