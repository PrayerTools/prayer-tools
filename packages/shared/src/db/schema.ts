// Kysely table types for prayer.tools' own tables (`pt_*`), plus the subset of
// Nuxtinator layer tables (core, tenancy, CRM, inbox) the public server and
// worker read and write. The admin app gets the layer tables from the layers
// themselves and merges only `PtTables` into its schema.
import type { ColumnType, Generated } from 'kysely'
import type { SitePlaceWording } from '../place'

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>
type NullableTimestamp = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>
type DateOnly = ColumnType<string, string, string>
type NullableDateOnly = ColumnType<string | null, string | null | undefined, string | null>
type Json<T> = ColumnType<T, T | string, T | string>
type JsonDefault<T> = ColumnType<T, T | string | undefined, T | string>

// ── Vocabularies (code-owned; labels live in i18n) ─────────────────────────

export type SiteStatus = 'draft' | 'published' | 'archived'
export type StartMode = 'date' | 'join'
export type EndMode = 'date' | 'none' | 'days'
export type Goal = 'people' | 'prayer_time' | 'coverage'
export type Cadence = 'daily' | 'weekly'
// Stored only for side campaigns; NULL is the site's main campaign.
export type CampaignKind = 'side'
export type SubscriptionStatus = 'active' | 'inactive' | 'completed' | 'unsubscribed'
export type Delivery = 'email' | 'app'
export type CommitmentKind = 'recurring' | 'dates'
export type Frequency = 'daily' | 'weekly'
export type DomainStatus = 'pending' | 'active' | 'failing'
export type DirectoryStatus = 'requested' | 'listed' | 'unlisted'
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed'
export type CheckinKind = 'checkin' | 'reminder' | 'manual'
export type CheckinResponse = 'yes' | 'sometimes' | 'no'
export type SessionSource = 'porch' | 'manage' | 'app' | 'email'
export type SignupFieldKind = 'text' | 'select' | 'checkbox'
export type LibraryVisibility = 'private' | 'published'
export type ShareStatus = 'requested' | 'approved' | 'rejected'

// Text a champion writes in one language and translates into the site's
// other languages. `stale` lists languages whose value predates the latest
// edit of the source language.
export interface TranslatableText {
  source: string
  values: Record<string, string>
  stale?: string[]
}

export interface TiptapDoc {
  type: 'doc'
  content?: TiptapNode[]
}

export interface TiptapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  marks?: { type: string, attrs?: Record<string, unknown> }[]
  text?: string
}

// ── Global tables ──────────────────────────────────────────────────────────

export interface PtUserDeviceTable {
  id: Generated<string>
  user_id: string
  credential_hash: string
  platform: string | null
  app_version: string | null
  push_id: string | null
  timezone: string | null
  language: string | null
  created_at: Timestamp
  last_seen_at: Timestamp
}

export type AuthCodePurpose = 'sign_in' | 'handoff' | 'email_change' | 'email_undo'

export interface PtAuthCodeTable {
  id: Generated<string>
  user_id: string
  purpose: AuthCodePurpose
  code_hash: string
  // handoff: the host the code may be redeemed on.
  host: string | null
  // email_change: the new address; email_undo: the address to go back to.
  email: string | null
  return_to: string | null
  // handoff: when the person signed in, carried to the session it starts.
  authenticated_at: NullableTimestamp
  expires_at: Timestamp
  used_at: NullableTimestamp
  created_at: Timestamp
}

export interface PtAccountSessionTable {
  id: Generated<string>
  user_id: string
  // The only host the session's cookie is accepted on, or `.<domain>` for
  // the platform host and sites sharing one cookie.
  host: string
  token_hash: string
  created_at: Generated<Date>
  last_used_at: Generated<Date>
  expires_at: Timestamp
  user_agent: string | null
  ip: string | null
}

export interface PtSuppressionTable {
  id: Generated<string>
  address_hash: string
  reason: 'hard_bounce' | 'complaint'
  detail: string | null
  source: string | null
  created_at: Timestamp
}

export interface PtJobTable {
  id: Generated<string>
  type: string
  org_id: string | null
  reference_type: string | null
  reference_id: string | null
  payload: JsonDefault<Record<string, unknown>>
  status: Generated<JobStatus>
  priority: Generated<number>
  scheduled_at: Timestamp
  attempts: Generated<number>
  max_attempts: Generated<number>
  last_attempt_at: NullableTimestamp
  error_message: string | null
  result: Json<Record<string, unknown> | null> | null
  completed_at: NullableTimestamp
  created_at: Timestamp
  updated_at: Timestamp
}

export interface PtSiteDomainTable {
  id: Generated<string>
  org_id: string
  hostname: string
  status: Generated<DomainStatus>
  cf_hostname_id: string | null
  verification: JsonDefault<Record<string, unknown>>
  last_checked_at: NullableTimestamp
  activated_at: NullableTimestamp
  failing_since: NullableTimestamp
  alerted_at: NullableTimestamp
  created_at: Timestamp
}

export interface PtDirectoryEntryTable {
  org_id: string
  slug: string
  name: string
  description: string | null
  languages: Generated<string[]>
  image_url: string | null
  status: DirectoryStatus
  people_count: Generated<number>
  campaign_name: string | null
  campaign_starts_on: NullableDateOnly
  requested_at: NullableTimestamp
  reviewed_by: string | null
  reviewed_at: NullableTimestamp
  updated_at: Timestamp
}

export interface PtSiteReportTable {
  id: Generated<string>
  org_id: string
  reason: string
  details: string | null
  source: string | null
  created_at: Timestamp
  handled_at: NullableTimestamp
  handled_by: string | null
}

export interface PtLibraryTable {
  id: Generated<string>
  owner_user_id: string | null
  title: string
  description: string | null
  cadence: Cadence
  entry_count: Generated<number>
  languages: Generated<string[]>
  source_language: string
  topics: Generated<string[]>
  template_keys: Generated<string[]>
  license: string
  license_note: string | null
  credit: string | null
  visibility: Generated<LibraryVisibility>
  share_status: ShareStatus | null
  share_requested_at: NullableTimestamp
  rights_confirmed: Generated<boolean>
  published_version: Generated<number>
  published_at: NullableTimestamp
  created_at: Timestamp
  updated_at: Timestamp
}

export interface PtLibraryEntryTable {
  id: Generated<string>
  library_id: string
  day: number
  language: string
  draft: Json<TiptapDoc>
  published: Json<TiptapDoc | null> | null
  published_version: number | null
  updated_at: Timestamp
}

export interface PtPersonalAssetTable {
  id: Generated<string>
  owner_user_id: string
  storage_key: string
  url: string
  url_small: string | null
  content_type: string
  width: number | null
  height: number | null
  alt: Json<TranslatableText | null> | null
  credit: string | null
  focal_x: Generated<number>
  focal_y: Generated<number>
  created_at: Timestamp
}

export interface PtPersonalBlockTable {
  id: Generated<string>
  owner_user_id: string
  name: string
  content: Json<TiptapDoc>
  created_at: Timestamp
  updated_at: Timestamp
}

export interface PtLegacyKeyTable {
  id: Generated<string>
  org_id: string
  kind: 'manage' | 'fuel' | 'ics'
  key_hash: string
  subscription_id: string | null
  created_at: Timestamp
}

// ── Site-scoped tables (org_id + RLS) ──────────────────────────────────────

// Site-wide look: shown on every campaign's pages and in emails.
export interface SiteBranding {
  color?: string
  logo_asset_id?: string
  logo_url?: string
}

// A campaign's hero image and link-preview image.
export interface CampaignBranding {
  image_asset_id?: string
  image_url?: string
  image_alt?: TranslatableText
  image_credit?: string
  focal_x?: number
  focal_y?: number
  share_image_url?: string
}

export interface SiteEmailIdentity {
  from_name?: string
  from_local?: string
  reply_to?: string
  logo_url?: string
  signature?: TranslatableText
}

export interface LandingCustomSection {
  id: string
  heading: TranslatableText
  body: Record<string, TiptapDoc>
  image_url?: string
  image_alt?: TranslatableText
  video_url?: string
  button_label?: TranslatableText
  button_url?: string
}

export interface CampaignLanding {
  why?: Record<string, TiptapDoc>
  hidden?: string[]
  custom?: LandingCustomSection[]
  stories?: boolean
}

export interface CampaignShare {
  messages?: TranslatableText
}

export interface SiteOnboarding {
  step?: string
  completed?: boolean
}

// The public contact form's extra questions, and who is notified of new
// messages. Without `notify_user_ids` the site's admins are notified.
export interface ContactFormField {
  key: string
  kind: SignupFieldKind
  label: TranslatableText
  options: { key: string, label: TranslatableText }[]
  required: boolean
}

export interface SiteContactForm {
  fields?: ContactFormField[]
  notify_user_ids?: string[]
}

export interface PtSiteTable {
  org_id: string
  status: Generated<SiteStatus>
  languages: Generated<string[]>
  default_language: Generated<string>
  timezone: Generated<string>
  branding: JsonDefault<SiteBranding>
  email_identity: JsonDefault<SiteEmailIdentity>
  settings: JsonDefault<Record<string, unknown>>
  onboarding: JsonDefault<SiteOnboarding>
  contact_form: JsonDefault<SiteContactForm>
  preview_token_hash: string | null
  published_at: NullableTimestamp
  archived_at: NullableTimestamp
  anonymized_at: NullableTimestamp
  created_at: Timestamp
  updated_at: Timestamp
}

export interface CampaignCta {
  label?: TranslatableText
  url?: string
}

export interface PtCampaignTable {
  id: Generated<string>
  org_id: Generated<string>
  slug: string
  name: string
  template_key: string | null
  kind: CampaignKind | null
  start_mode: StartMode
  start_date: NullableDateOnly
  end_mode: EndMode
  end_date: NullableDateOnly
  length_days: number | null
  goal: Goal
  cadence: Cadence
  track_time: Generated<boolean>
  goal_target: number | null
  slot_min: number | null
  timezone: string
  place_name: string | null
  place_wording: JsonDefault<SitePlaceWording>
  people_group: string | null
  latitude: number | null
  longitude: number | null
  end_message: Json<TranslatableText | null> | null
  cta: JsonDefault<CampaignCta>
  landing: JsonDefault<CampaignLanding>
  branding: JsonDefault<CampaignBranding>
  share: JsonDefault<CampaignShare>
  description: Json<TranslatableText | null> | null
  // Null while the campaign is a draft being set up.
  published_at: NullableTimestamp
  ended_at: NullableTimestamp
  created_at: Timestamp
  updated_at: Timestamp
}

export interface PtSiteLibraryTable {
  id: Generated<string>
  org_id: Generated<string>
  library_id: string | null
  title: string
  cadence: Cadence
  frozen_version: number | null
  created_at: Timestamp
}

export interface PtSiteEntryTable {
  id: Generated<string>
  org_id: Generated<string>
  site_library_id: string
  day: number
  language: string
  content: Json<TiptapDoc>
  edited: Generated<boolean>
  stale: Generated<boolean>
  updated_at: Timestamp
}

export interface PtCampaignLibraryTable {
  id: Generated<string>
  org_id: Generated<string>
  campaign_id: string
  site_library_id: string
  position: Generated<number>
}

export interface PtSubscriptionTable {
  id: Generated<string>
  org_id: Generated<string>
  contact_id: string | null
  user_id: string | null
  status: Generated<SubscriptionStatus>
  delivery: Generated<Delivery>
  language: string
  timezone: string
  verified_at: NullableTimestamp
  verify_token_hash: string | null
  verify_expires_at: NullableTimestamp
  // "News from Prayer.Tools" asked for before the address was verified.
  platform_news_requested_at: NullableTimestamp
  manage_version: Generated<number>
  referral_code: string
  referred_by: string | null
  joined_from: string | null
  last_activity_at: NullableTimestamp
  checkin_cycle_started_at: NullableTimestamp
  unsubscribed_at: NullableTimestamp
  inactive_at: NullableTimestamp
  completed_at: NullableTimestamp
  anonymized_at: NullableTimestamp
  created_at: Timestamp
  updated_at: Timestamp
}

export interface PtCommitmentTable {
  id: Generated<string>
  org_id: Generated<string>
  subscription_id: string
  campaign_id: string
  kind: Generated<CommitmentKind>
  frequency: Frequency | null
  days_of_week: Generated<number[]>
  time: string
  timezone: string
  duration_min: number | null
  dates: Generated<Date[]>
  starts_on: DateOnly
  ends_on: NullableDateOnly
  paused: Generated<boolean>
  next_reminder_utc: NullableTimestamp
  claimed_at: NullableTimestamp
  entries_done: Generated<number>
  advanced_on: NullableDateOnly
  // Personal-start campaigns: when the person went through the last entry.
  finished_at: NullableTimestamp
  created_at: Timestamp
  updated_at: Timestamp
}

export interface PtReminderSentTable {
  commitment_id: string
  org_id: Generated<string>
  local_date: DateOnly
  sent_at: Timestamp
}

export interface PtCheckinTable {
  id: Generated<string>
  org_id: Generated<string>
  subscription_id: string
  kind: CheckinKind
  token_hash: string | null
  sent_at: Timestamp
  response: CheckinResponse | null
  responded_at: NullableTimestamp
}

// What the signup form asked for, kept until the address's owner confirms it
// (see `SignupRequest` in the public server).
export interface PtSignupRequestTable {
  id: Generated<string>
  org_id: Generated<string>
  subscription_id: string
  campaign_id: string
  token_hash: string
  request: Json<Record<string, unknown>>
  expires_at: Timestamp
  created_at: Timestamp
}

export interface PtEmailLogTable {
  id: Generated<string>
  org_id: Generated<string>
  subscription_id: string
  campaign_id: string | null
  kind: string
  subject: string
  day: number | null
  sent_at: Timestamp
}

export interface PtPrayerSessionTable {
  id: string
  org_id: Generated<string>
  campaign_id: string | null
  subscription_id: string | null
  user_id: string | null
  source: SessionSource
  day: number | null
  language: string | null
  country: string | null
  started_at: Timestamp
  last_ping_at: Timestamp
  seconds: Generated<number>
  completed: Generated<boolean>
  group_size: Generated<number>
}

export interface PtPersonTotalTable {
  org_id: Generated<string>
  campaign_id: string
  subscription_id: string
  prayers: Generated<number>
  seconds: Generated<number>
  last_prayed_at: NullableTimestamp
}

export interface PtStatDailyTable {
  org_id: Generated<string>
  campaign_id: string | null
  day: DateOnly
  metric: string
  value: Generated<string>
}

export interface PtStatDimDailyTable {
  org_id: Generated<string>
  campaign_id: string | null
  day: DateOnly
  dim: string
  key: string
  value: Generated<string>
}

export interface PtStatVisitorDayTable {
  org_id: Generated<string>
  day: DateOnly
  visitor_hash: string
}

export interface PtEventTable {
  id: Generated<string>
  org_id: Generated<string>
  campaign_id: string | null
  type: string
  visitor_hash: string | null
  country: string | null
  source: string | null
  meta: JsonDefault<Record<string, unknown>>
  created_at: Timestamp
}

export interface PtStoryTable {
  id: Generated<string>
  org_id: Generated<string>
  campaign_id: string | null
  conversation_id: string | null
  name: string | null
  body: string
  language: string
  may_publish: Generated<boolean>
  may_platform: Generated<boolean>
  use_name: Generated<boolean>
  wording_version: string
  published: Generated<boolean>
  published_at: NullableTimestamp
  created_at: Timestamp
}

export interface PtConsentOptionTable {
  id: Generated<string>
  org_id: Generated<string>
  key: string
  label: Json<TranslatableText>
  active: Generated<boolean>
  position: Generated<number>
  created_at: Timestamp
}

export interface PtSignupFieldTable {
  id: Generated<string>
  org_id: Generated<string>
  key: string
  kind: SignupFieldKind
  label: Json<TranslatableText>
  options: JsonDefault<{ key: string, label: TranslatableText }[]>
  required: Generated<boolean>
  position: Generated<number>
  created_at: Timestamp
}

export interface PtSiteStringTable {
  org_id: Generated<string>
  key: string
  language: string
  value: string
  updated_at: Timestamp
}

export interface PtExportLogTable {
  id: Generated<string>
  org_id: Generated<string>
  user_id: string
  row_count: number
  created_at: Timestamp
}

export interface PtCoverageCacheTable {
  org_id: Generated<string>
  campaign_id: string
  slots: Json<number[]>
  computed_at: Timestamp
}

export interface PtTables {
  pt_user_device: PtUserDeviceTable
  pt_auth_code: PtAuthCodeTable
  pt_account_session: PtAccountSessionTable
  pt_suppression: PtSuppressionTable
  pt_job: PtJobTable
  pt_site_domain: PtSiteDomainTable
  pt_directory_entry: PtDirectoryEntryTable
  pt_site_report: PtSiteReportTable
  pt_library: PtLibraryTable
  pt_library_entry: PtLibraryEntryTable
  pt_personal_asset: PtPersonalAssetTable
  pt_personal_block: PtPersonalBlockTable
  pt_legacy_key: PtLegacyKeyTable
  pt_site: PtSiteTable
  pt_campaign: PtCampaignTable
  pt_site_library: PtSiteLibraryTable
  pt_site_entry: PtSiteEntryTable
  pt_campaign_library: PtCampaignLibraryTable
  pt_subscription: PtSubscriptionTable
  pt_commitment: PtCommitmentTable
  pt_reminder_sent: PtReminderSentTable
  pt_checkin: PtCheckinTable
  pt_signup_request: PtSignupRequestTable
  pt_email_log: PtEmailLogTable
  pt_prayer_session: PtPrayerSessionTable
  pt_person_total: PtPersonTotalTable
  pt_stat_daily: PtStatDailyTable
  pt_stat_dim_daily: PtStatDimDailyTable
  pt_stat_visitor_day: PtStatVisitorDayTable
  pt_event: PtEventTable
  pt_story: PtStoryTable
  pt_consent_option: PtConsentOptionTable
  pt_signup_field: PtSignupFieldTable
  pt_site_string: PtSiteStringTable
  pt_export_log: PtExportLogTable
  pt_coverage_cache: PtCoverageCacheTable
}

// ── Nuxtinator layer tables used outside the admin app ─────────────────────

export interface UsersTable {
  id: Generated<string>
  created: Generated<Date>
  updated: Generated<Date>
  email: string | null
  display_name: string
  password: string | null
  is_admin: Generated<boolean>
  verified: Generated<boolean>
}

// The social-auth layer's Google / Apple accounts linked to a user.
export interface UserIdentitiesTable {
  id: Generated<string>
  user_id: string
  provider: string
  subject: string
  email: string | null
  created_at: Generated<Date>
  last_used_at: Generated<Date>
}

// Core's admin app sign-ins.
export interface SessionsTable {
  id: Generated<string>
  user_id: string
}

export interface OrgsTable {
  id: Generated<string>
  slug: string
  name: string
  suspended_at: NullableTimestamp
  created_at: Timestamp
  updated_at: Timestamp
}

export interface MembershipsTable {
  id: Generated<string>
  user_id: string
  org_id: string
  roles: Generated<string[]>
  created_at: Timestamp
  updated_at: Timestamp
}

export interface CrmRecordsTable {
  id: Generated<string>
  org_id: Generated<string>
  record_type: string
  name: string
  status: string | null
  data: JsonDefault<Record<string, unknown>>
  created_by: string
  created_at: Timestamp
  updated_at: Timestamp
  // The person's account; it owns the contact's name and email address.
  user_id: string | null
}

export interface CrmChannelsTable {
  id: Generated<string>
  org_id: Generated<string>
  channel_type: string
  value: string
  normalized_value: string
  verified: Generated<boolean>
  verified_at: NullableTimestamp
  verification_token_hash: string | null
  verification_expires_at: NullableTimestamp
  created_at: Timestamp
  updated_at: Timestamp
}

export interface CrmContactChannelsTable {
  id: Generated<string>
  org_id: Generated<string>
  record_id: string
  channel_id: string
  field_key: string
  label: string | null
  is_primary: Generated<boolean>
  sort_order: Generated<number>
}

export interface CrmChannelConsentsTable {
  id: Generated<string>
  org_id: Generated<string>
  channel_id: string
  purpose: string
  status: 'opt_in' | 'opt_out'
  granted_at: NullableTimestamp
  revoked_at: NullableTimestamp
  source: string | null
  capture_meta: JsonDefault<Record<string, unknown>>
}

export interface CrmConsentEventsTable {
  id: Generated<string>
  org_id: Generated<string>
  channel_id: string | null
  channel_value: string
  address_fingerprint: string
  purpose: string
  event: 'grant' | 'revoke'
  source: string | null
  actor_user_id: string | null
  ip: string | null
  user_agent: string | null
  meta: JsonDefault<Record<string, unknown>>
  occurred_at: Timestamp
}

export interface CrmRecordActivityTable {
  id: Generated<string>
  org_id: Generated<string>
  record_id: string
  actor_user_id: string | null
  actor_label: string | null
  action: string
  field_key: string | null
  old_value: unknown
  new_value: unknown
  note: string | null
  created_at: Timestamp
}

export interface InboxConversationsTable {
  id: Generated<string>
  org_id: Generated<string>
  channel_id: string
  subject: string | null
  status: Generated<string>
  assigned_user_id: string | null
  reply_token: string
  needs_review: Generated<boolean>
  source: string
  counterparty_name: string | null
  last_message_at: NullableTimestamp
  last_message_direction: string | null
  tags: Generated<string[]>
  created_at: Timestamp
  updated_at: Timestamp
}

export interface InboxMessagesTable {
  id: Generated<string>
  org_id: Generated<string>
  conversation_id: string
  direction: 'inbound' | 'outbound'
  status: string
  from_email: string | null
  from_name: string | null
  to_email: string | null
  subject: string | null
  body_html: string | null
  body_stripped_html: string | null
  body_text: string | null
  email_message_id: string | null
  authenticated: Generated<boolean>
  created_at: Timestamp
  updated_at: Timestamp
}

export interface NotificationsTable {
  id: Generated<string>
  org_id: Generated<string>
  user_id: string
  app_id: string
  title: string
  body: string | null
  icon: string | null
  link: string
  actor_id: string | null
  email_mode: Generated<'immediate' | 'digest' | 'none'>
  created_at: Generated<Date>
  read_at: NullableTimestamp
  emailed_at: NullableTimestamp
}

export interface LayerTables {
  users: UsersTable
  user_identities: UserIdentitiesTable
  sessions: SessionsTable
  orgs: OrgsTable
  memberships: MembershipsTable
  crm_records: CrmRecordsTable
  crm_channels: CrmChannelsTable
  crm_contact_channels: CrmContactChannelsTable
  crm_channel_consents: CrmChannelConsentsTable
  crm_consent_events: CrmConsentEventsTable
  crm_record_activity: CrmRecordActivityTable
  inbox_conversations: InboxConversationsTable
  inbox_messages: InboxMessagesTable
  notifications: NotificationsTable
}

export type DB = PtTables & LayerTables
