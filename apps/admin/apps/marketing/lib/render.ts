// Email content: validating what the composer sends, picking the version for a
// recipient's language, and rendering it through the host.
import type { EmailVersion, EmailVersions, MarketingHost, MarketingRecipient, MarketingTx, TiptapDoc } from './types'

export const SUBJECT_MAX = 200
export const PREHEADER_MAX = 200

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

export function fillVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{([a-z_]+)\}/g, (m, key: string) => (key in vars ? vars[key]! : m))
}

function isDoc(v: unknown): v is TiptapDoc {
  return !!v && typeof v === 'object' && (v as { type?: unknown }).type === 'doc'
}

function hasText(doc: TiptapDoc | undefined): boolean {
  const walk = (nodes: TiptapDoc['content']): boolean => (nodes ?? []).some(n =>
    (n.type === 'text' && !!n.text?.trim()) || n.type === 'image' || walk(n.content))
  return !!doc && walk(doc.content)
}

export function isVersionComplete(v: EmailVersion | undefined): boolean {
  return !!v && !!v.subject.trim() && hasText(v.content)
}

// Keeps well-formed versions only; throws a 400-shaped error on bad input.
export function parseVersions(input: unknown, languages?: string[]): EmailVersions {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw badRequest('versions must be an object keyed by language.')
  const out: EmailVersions = {}
  for (const [lang, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(lang)) throw badRequest(`Unknown language "${lang}".`)
    if (languages && !languages.includes(lang)) continue
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const subject = String(r.subject ?? '').trim().slice(0, SUBJECT_MAX)
    const preheader = String(r.preheader ?? '').trim().slice(0, PREHEADER_MAX)
    const content = isDoc(r.content) ? r.content : { type: 'doc' as const, content: [] }
    out[lang] = { subject, ...(preheader ? { preheader } : {}), content }
  }
  if (JSON.stringify(out).length > 500_000) throw badRequest('The email is too large.')
  return out
}

export function badRequest(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400, statusMessage: message })
}

// Problems that block sending: the source version must be complete; other
// versions are sent only when complete (else the source is used).
export function sendProblems(versions: EmailVersions, sourceLanguage: string, audiences: string[]): string[] {
  const problems: string[] = []
  const src = versions[sourceLanguage]
  if (!src?.subject.trim()) problems.push('Add a subject.')
  if (!hasText(src?.content)) problems.push('Write the email.')
  if (!audiences.length) problems.push('Choose at least one audience.')
  return problems
}

export function pickLanguage(versions: EmailVersions, sourceLanguage: string, wanted: string): string {
  return isVersionComplete(versions[wanted]) ? wanted : sourceLanguage
}

function preheaderHtml(text: string): string {
  if (!text) return ''
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(text)}${'&#8199;&#847;'.repeat(40)}</div>`
}

export interface RenderedEmail {
  lang: string
  subject: string
  preheader: string
  html: string
  text: string
}

export async function renderEmail(
  host: MarketingHost,
  tx: MarketingTx,
  orgId: string,
  email: { versions: EmailVersions, source_language: string },
  wantedLang: string,
  recipient: MarketingRecipient | null,
  opts: { unsubscribeUrl: string | null, test: boolean, vars?: Record<string, string> }
): Promise<RenderedEmail> {
  const lang = pickLanguage(email.versions, email.source_language, wantedLang)
  const v = email.versions[lang] ?? email.versions[email.source_language]!
  const vars = { ...(await host.variables(tx, orgId, lang, recipient)), ...(opts.vars ?? {}) }
  const subject = fillVars(v.subject, vars)
  const preheader = fillVars(v.preheader ?? '', vars)
  const body = await host.renderContent(tx, orgId, v.content, { lang, vars })
  const wrapped = await host.wrap(tx, orgId, lang, { html: preheaderHtml(preheader) + body.html, text: body.text }, { unsubscribeUrl: opts.unsubscribeUrl, test: opts.test })
  return { lang, subject, preheader, html: wrapped.html, text: wrapped.text }
}
