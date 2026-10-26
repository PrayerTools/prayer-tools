// The view model the server builds for every page request. The catch-all
// page renders it; SSR reads it from the request context and client-side
// navigation fetches it from `/api/view`.
import type { CheckinResponse, Goal, Cadence, StartMode, SignupFieldKind, SubscriptionStatus } from '@prayertools/shared/db/schema'
import type { VideoEmbed } from '@prayertools/shared/video'

export type CampaignState = 'upcoming' | 'active' | 'between' | 'ended'

export interface CampaignView {
  id: string
  slug: string
  name: string
  state: CampaignState
  isCurrent: boolean
  // Runs beside the main campaign at its own address.
  side: boolean
  goal: Goal
  goalTarget: number | null
  cadence: Cadence
  startMode: StartMode
  startDate: string | null
  endDate: string | null
  timezone: string
  length: number | null
  durationRule: 'required' | 'optional' | 'hidden'
  durations: number[]
  defaultDuration: number
  // 24/7 coverage campaigns: minutes in one coverage slot.
  slotMinutes: number | null
  todayEntry: number
}

// A side campaign the main landing page points to.
export interface SideCampaignView {
  slug: string
  name: string
  state: 'upcoming' | 'active'
  startDate: string | null
  endDate: string | null
}

export interface SiteView {
  orgId: string
  slug: string
  name: string
  url: string
  path: string
  lang: string
  uiLang: string
  dir: 'ltr' | 'rtl'
  defaultLanguage: string
  languages: { code: string, native: string }[]
  brand: { color: string, text: string }
  logoUrl: string | null
  image: { url: string, alt: string, credit: string | null, fx: number, fy: number } | null
  shareImageUrl: string | null
  description: string
  status: 'draft' | 'published' | 'archived'
  preview: boolean
  // Set inside the admin landing-page editor's preview frame.
  editor: { adminOrigin: string, defaults: Record<string, string> } | null
  campaign: CampaignView | null
  // Campaign segment in links, null for the current campaign.
  campaignSegment: string | null
  pastCampaigns: { slug: string, name: string }[]
  strings: Record<string, string>
  shareMessage: string | null
  settings: { showPeopleCount: boolean, showPrayingNow: boolean, sharePrompts: boolean }
  donateUrl: string
  myUrl: string
  goUrl: string
  appStoreUrl: string | null
  playStoreUrl: string | null
  feedback: { scriptUrl: string, projectId: string, apiBase: string } | null
  turnstileSiteKey: string | null
}

export interface GoalProgressView {
  goal: Goal
  people: number
  value: number
  target: number | null
  percent: number | null
}

export interface ContentBlockView {
  title: string
  html: string
  credit: string | null
  license: string | null
}

export interface StatsView {
  progress: GoalProgressView
  commitments: number
  prayers: number
  prayerMinutes: number
  groupPrayers: number
  shareSignups: number
  prayingNow: number
}

export interface StoryView {
  id: string
  body: string
  name: string | null
}

export interface CustomSectionView {
  id: string
  heading: string
  html: string
  imageUrl: string | null
  imageAlt: string
  video: VideoEmbed | null
  buttonLabel: string | null
  buttonUrl: string | null
}

export interface ConsentOptionView {
  key: string
  label: string
}

export interface SignupFieldView {
  key: string
  kind: SignupFieldKind
  label: string
  required: boolean
  options: { key: string, label: string }[]
}

export interface SignupFormView {
  consentOptions: ConsentOptionView[]
  fields: SignupFieldView[]
  googleClientId: string | null
  appleServicesId: string | null
  open: boolean
}

export interface CommitmentView {
  id: string
  campaignId: string
  campaignName: string
  campaignEnded: boolean
  kind: 'recurring' | 'dates'
  frequency: 'daily' | 'weekly' | null
  daysOfWeek: number[]
  time: string
  timezone: string
  durationMin: number | null
  dates: string[]
  paused: boolean
  startsOn: string
  endsOn: string | null
}

// One campaign on the manage page with the person's prayer times in it.
export interface ManageCampaignView {
  id: string
  name: string
  state: 'upcoming' | 'active' | 'ended'
  // Start-anytime campaigns hold one prayer time per person.
  personal: boolean
  durationRule: 'required' | 'optional' | 'hidden'
  durations: number[]
  defaultDuration: number
  commitments: CommitmentView[]
}

export interface ManageView {
  subscriptionId: string
  name: string
  email: string | null
  language: string
  timezone: string
  status: SubscriptionStatus
  verified: boolean
  referralCode: string
  campaigns: ManageCampaignView[]
  consents: { key: string, label: string, granted: boolean }[]
  icsUrl: string
  prayUrl: string
}

export interface MySiteView {
  orgId: string
  subscriptionId: string
  name: string
  url: string
  languages: { code: string, native: string }[]
  language: string
  timezone: string
  status: SubscriptionStatus
  siteUpdates: boolean
  customConsents: { key: string, label: string, granted: boolean }[]
  current: { campaign: { id: string, name: string, state: CampaignState, goal: Goal, durationRule: 'required' | 'optional' | 'hidden', durations: number[], defaultDuration: number }, commitments: CommitmentView[] }[]
  past: { id: string, name: string, prayers: number, minutes: number }[]
}

export interface MyView {
  signedIn: boolean
  sites: MySiteView[]
}

export type PageView =
  | { kind: 'landing', sections: string[], progress: GoalProgressView | null, why: string, today: { day: number, html: string, title: string } | null, stories: StoryView[], custom: CustomSectionView[], prayingNow: number, form: SignupFormView, placeholders: string[], side: SideCampaignView[] }
  | { kind: 'between', stats: StatsView | null, endMessage: string, cta: { label: string, url: string } | null }
  | { kind: 'archived' }
  | { kind: 'not_started', startDate: string }
  | { kind: 'pray', day: number, chosen: boolean, personal: boolean, dateLabel: string | null, blocks: ContentBlockView[], prev: number | null, next: number | null, length: number | null }
  | { kind: 'signup', form: SignupFormView }
  | { kind: 'stats', stats: StatsView }
  | { kind: 'coverage', progress: GoalProgressView | null }
  | { kind: 'contact' }
  | { kind: 'stories' }
  | { kind: 'manage', manage: ManageView | null }
  | { kind: 'link_expired', token: string }
  | { kind: 'unsubscribe', token: string, valid: boolean }
  | { kind: 'notice', key: string }
  | { kind: 'embed', progress: GoalProgressView | null }
  | { kind: 'not_found' }

export interface SiteResponse {
  host: 'site'
  site: SiteView
  page: PageView
  status: number
  cache: 'shared' | 'private'
  title: string
  robots?: string
  canonical?: string
}

export interface PlatformResponse {
  host: 'platform'
  lang: string
  donateUrl: string
  page: { kind: 'my', my: MyView, notice: string | null } | { kind: 'home', adminUrl: string } | { kind: 'not_found' }
  status: number
  cache: 'private'
  title: string
}

export type ViewResponse = SiteResponse | PlatformResponse

export type { CheckinResponse }
