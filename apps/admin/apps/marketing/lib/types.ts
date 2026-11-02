// The marketing layer's data model and the contract a host fills in. Plain
// TypeScript: the admin app, the worker and tests all import it.
import type { ColumnType, Generated, Kysely, Transaction } from 'kysely'

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>
type NullableTimestamp = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>
type Json<T> = ColumnType<T, T | string, T | string>

// ── Vocabularies (code-owned) ───────────────────────────────────────────────

export const EMAIL_STATUSES = ['draft', 'scheduled', 'sending', 'paused', 'sent', 'cancelled', 'failed'] as const
export type EmailStatus = typeof EMAIL_STATUSES[number]

export const DELIVERY_STATUSES = ['pending', 'sent', 'skipped', 'failed'] as const
export type DeliveryStatus = typeof DELIVERY_STATUSES[number]

export type SkipReason = 'no_consent' | 'suppressed' | 'cancelled' | 'no_address' | 'recipient_check'
export type PauseReason = 'manual' | 'complaint_rate'
// The worker refused the send: more deliveries than the site has email
// addresses, or a delivery to another site's address.
export type FailedReason = 'recipient_check'

// ── Content ─────────────────────────────────────────────────────────────────

export interface TiptapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  marks?: { type: string, attrs?: Record<string, unknown> }[]
  text?: string
}

export interface TiptapDoc {
  type: 'doc'
  content?: TiptapNode[]
}

// One language version of an email.
export interface EmailVersion {
  subject: string
  preheader?: string
  content: TiptapDoc
}

export type EmailVersions = Record<string, EmailVersion>

// ── Tables ──────────────────────────────────────────────────────────────────

export interface MarketingEmailTable {
  id: Generated<string>
  org_id: Generated<string>
  parent_id: string | null
  // A multi-site send's chosen sites (empty for a single-site email).
  parent_org_ids: Generated<string[]>
  versions: Json<EmailVersions>
  source_language: string
  audiences: Generated<string[]>
  status: Generated<EmailStatus>
  scheduled_at: NullableTimestamp
  started_at: NullableTimestamp
  finished_at: NullableTimestamp
  paused_reason: string | null
  failed_reason: string | null
  recipients: Generated<number>
  sent: Generated<number>
  skipped: Generated<number>
  failed: Generated<number>
  unsubscribes: Generated<number>
  created_by: string | null
  created_at: Timestamp
  updated_at: Timestamp
}

export interface MarketingDeliveryTable {
  id: Generated<string>
  org_id: Generated<string>
  email_id: string
  contact_id: string | null
  channel_id: string | null
  address: string | null
  first_name: string | null
  language: string
  purpose: string | null
  status: Generated<DeliveryStatus>
  skip_reason: string | null
  error: string | null
  attempts: Generated<number>
  claimed_at: NullableTimestamp
  provider_id: string | null
  sent_at: NullableTimestamp
  created_at: Timestamp
}

export interface MarketingParentTable {
  id: Generated<string>
  owner_user_id: string
  versions: Json<EmailVersions>
  source_language: string
  org_ids: Generated<string[]>
  audiences: Generated<string[]>
  status: Generated<EmailStatus>
  scheduled_at: NullableTimestamp
  resolved_at: NullableTimestamp
  started_at: NullableTimestamp
  finished_at: NullableTimestamp
  people: Generated<number>
  recipients: Generated<number>
  sent: Generated<number>
  skipped: Generated<number>
  failed: Generated<number>
  unsubscribes: Generated<number>
  created_at: Timestamp
  updated_at: Timestamp
}

export interface MarketingParentRecipientTable {
  parent_id: string
  fingerprint: string
  org_id: string
  joined_at: Timestamp
}

export interface MarketingTemplateTable {
  id: Generated<string>
  owner_user_id: string
  name: string
  versions: Json<EmailVersions>
  source_language: string
  created_at: Timestamp
  updated_at: Timestamp
}

export interface MarketingTables {
  marketing_email: MarketingEmailTable
  marketing_delivery: MarketingDeliveryTable
  marketing_parent: MarketingParentTable
  marketing_parent_recipient: MarketingParentRecipientTable
  marketing_template: MarketingTemplateTable
}

// The CRM and tenancy tables the layer reads directly.
interface CrmChannelConsentsRead {
  id: Generated<string>
  org_id: Generated<string>
  channel_id: string
  purpose: string
  status: 'opt_in' | 'opt_out'
}

interface CrmChannelsRead {
  id: Generated<string>
  org_id: Generated<string>
  channel_type: string
  value: string
  normalized_value: string
  verified: Generated<boolean>
}

interface OrgsRead {
  id: Generated<string>
  slug: string
  name: string
  suspended_at: NullableTimestamp
}

export interface MarketingDatabase extends MarketingTables {
  crm_channel_consents: CrmChannelConsentsRead
  crm_channels: CrmChannelsRead
  orgs: OrgsRead
}

export type MarketingDb = Kysely<MarketingDatabase>
export type MarketingTx = Transaction<MarketingDatabase>

// ── Host contract ───────────────────────────────────────────────────────────
// Every host method that touches data receives the org-scoped transaction
// (`app.current_org` is set), typed loosely so a host can use its own schema.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HostTx = Transaction<any>

export interface MarketingAudience {
  key: string
  label: string
  description?: string
  // CRM consent purpose a recipient must be opted into.
  purpose: string
}

export interface AudienceMember {
  contactId: string | null
  channelId: string
  address: string
  language: string
  joinedAt: Date
  firstName?: string | null
}

export interface MarketingRecipient {
  contactId: string | null
  channelId: string | null
  address: string
  language: string
  firstName?: string | null
}

export interface MarketingLanguage {
  code: string
  label: string
  dir: 'ltr' | 'rtl'
}

export interface MarketingSender {
  fromName: string
  fromLocal: string
  replyTo: string | null
}

export interface MarketingVariable {
  key: string
  label: string
}

export interface MarketingMail {
  to: string
  fromName: string
  fromLocal: string
  replyTo: string | null
  subject: string
  html: string
  text: string
  // RFC 8058 one-click endpoint, sent as List-Unsubscribe + List-Unsubscribe-Post.
  unsubscribeUrl: string | null
  meta: Record<string, string>
}

export interface ConsentWithdrawal {
  source: string
  surface: string
  ip?: string | null
  userAgent?: string | null
}

export interface MarketingHost {
  // The personal app (`registerApp({ scope: 'user' })`) whose handlers own a
  // user's templates and multi-site sends.
  personalAppId: string
  // HMAC secret for unsubscribe tokens.
  secret(): string
  // Origin serving the layer's unsubscribe page and endpoint.
  unsubscribeBaseUrl(): string

  listAudiences(tx: HostTx, orgId: string): Promise<MarketingAudience[]>
  resolveAudience(tx: HostTx, orgId: string, key: string): Promise<AudienceMember[]> | AsyncIterable<AudienceMember>

  languages(tx: HostTx, orgId: string): Promise<{ languages: MarketingLanguage[], defaultLanguage: string }>
  variableList: MarketingVariable[]
  // Placeholder values for one recipient (null: a preview or test send).
  variables(tx: HostTx, orgId: string, lang: string, recipient: MarketingRecipient | null): Promise<Record<string, string>>
  renderContent(tx: HostTx, orgId: string, doc: TiptapDoc, opts: { lang: string, vars: Record<string, string> }): Promise<{ html: string, text: string }>
  // Branding and footer around the body.
  wrap(tx: HostTx, orgId: string, lang: string, body: { html: string, text: string }, opts: { unsubscribeUrl: string | null, test: boolean }): Promise<{ html: string, text: string }>
  sender(tx: HostTx, orgId: string): Promise<MarketingSender>

  // Lowercased addresses on the global suppression list.
  suppressedAmong(tx: HostTx, addresses: string[]): Promise<Set<string>>
  // Channel ids opted into `purpose`. Defaults to the CRM consent state.
  consentedAmong?(tx: HostTx, channelIds: string[], purpose: string): Promise<Set<string>>
  // The org's email channel for an address, if any.
  findChannel?(tx: HostTx, orgId: string, address: string): Promise<string | null>
  withdrawConsent(tx: HostTx, channelId: string, purpose: string, capture: ConsentWithdrawal): Promise<boolean>

  send(mail: MarketingMail): Promise<{ id: string | null }>

  // Marketing complaints recorded for the org since `since`.
  complaintCount(tx: HostTx, orgId: string, since: Date): Promise<number>
  throttlePerMinute(orgId: string): number
  // Complaint rate that pauses an org's sends; defaults to COMPLAINT_PAUSE_RATE.
  complaintPauseRate?: number

  // The email body format AI clients write through the MCP tools: `help`
  // describes it, `toDoc` converts it (throwing an Error that says what is
  // wrong) and `fromDoc` reads a body back. Without it the tools take and
  // return Tiptap JSON.
  mcpContent?: {
    help: string
    toDoc(blocks: unknown[]): TiptapDoc
    fromDoc(doc: TiptapDoc): { blocks: unknown[], exact: boolean }
  }
}
