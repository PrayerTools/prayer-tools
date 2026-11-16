export interface MarketingLanguage { code: string, label: string, dir: 'ltr' | 'rtl' }
export interface MarketingVariable { key: string, label: string }
export interface MarketingDoc { type: 'doc', content?: unknown[] }
export interface MarketingVersion { subject: string, preheader?: string, content: MarketingDoc }
export type MarketingVersions = Record<string, MarketingVersion>
export interface MarketingDraft { versions: MarketingVersions, source_language: string, audiences: string[] }
// The steps a draft is written in: subject and audience, the email itself, then preview and send.
export type MarketingStep = 'details' | 'content' | 'review'

export const MARKETING_STATUS: Record<string, { label: string, color: 'neutral' | 'info' | 'primary' | 'warning' | 'success' | 'error' }> = {
  draft: { label: 'Draft', color: 'neutral' },
  scheduled: { label: 'Scheduled', color: 'info' },
  sending: { label: 'Sending', color: 'primary' },
  paused: { label: 'Paused', color: 'warning' },
  sent: { label: 'Sent', color: 'success' },
  cancelled: { label: 'Cancelled', color: 'error' },
  failed: { label: 'Not sent', color: 'error' }
}

export const MARKETING_SKIP_REASONS: Record<string, string> = {
  no_consent: 'Didn\'t opt in',
  suppressed: 'Address bounced or complained',
  cancelled: 'Cancelled before sending',
  no_address: 'No address',
  recipient_check: 'Stopped by the recipient check'
}

export const MARKETING_PAUSE_REASONS: Record<string, string> = {
  manual: 'Paused by a team member.',
  complaint_rate: 'Paused automatically: too many recipients marked this site\'s email as spam this week. It stays paused until the complaint rate drops.'
}

export const MARKETING_FAILED_REASONS: Record<string, string> = {
  recipient_check: 'Not sent: its recipients didn\'t match this site\'s people, so Prayer.Tools stopped it. Nobody received it. Contact support.'
}

export function marketingEmptyDoc(): MarketingDoc {
  return { type: 'doc', content: [] }
}

export function marketingEmptyVersion(): MarketingVersion {
  return { subject: '', preheader: '', content: marketingEmptyDoc() }
}

export function marketingErrorMessage(err: unknown): string {
  const e = err as { data?: { statusMessage?: string, message?: string }, statusMessage?: string, message?: string }
  return e?.data?.statusMessage || e?.data?.message || e?.statusMessage || e?.message || 'Something went wrong.'
}

export function marketingDate(d: string | Date | null | undefined): string {
  if (!d) return ''
  return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function marketingHasText(doc: MarketingDoc | undefined): boolean {
  const walk = (nodes: unknown[] | undefined): boolean => (nodes ?? []).some((n) => {
    const node = n as { type?: string, text?: string, content?: unknown[] }
    return (node.type === 'text' && !!node.text?.trim()) || node.type === 'image' || walk(node.content)
  })
  return !!doc && walk(doc.content)
}
