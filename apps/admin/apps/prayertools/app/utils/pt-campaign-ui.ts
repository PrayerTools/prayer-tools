// Display helpers shared by the campaign list and campaign pages.
import type { CampaignEmailText, CampaignLanding, TranslatableText } from '@prayertools/shared/db/schema'
import type { SitePlaceWording } from '@prayertools/shared/place'
import type { SetupState } from '../components/PtSetupForm.vue'
import { campaignEndDate } from '@prayertools/shared/setup'
import { entryNumber } from '@prayertools/shared/schedule'
import { addMonths } from '@prayertools/shared/dates'

export type PtCampaignSummary = Pick<SetupState, 'start_mode' | 'start_date' | 'end_mode' | 'end_date' | 'length_days' | 'goal' | 'cadence'>

export const PT_CADENCE_ITEMS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' }
]

export interface PtGoalProgress {
  goal: string
  people: number
  value: number
  target: number | null
  percent: number | null
}

// A campaign as the campaign routes return it.
export interface PtCampaign extends SetupState {
  id: string
  slug: string
  name: string
  template_key: string | null
  // 'side' runs beside the main campaign at its own address; null is a main campaign.
  kind: 'side' | null
  timezone: string
  place_name: string | null
  place_wording: SitePlaceWording
  people_group: string | null
  latitude: number | null
  longitude: number | null
  status: 'upcoming' | 'active' | 'ended'
  ended_at: string | null
  // Null while the campaign is a draft being set up.
  published_at: string | null
  end_message: TranslatableText | null
  cta: { url?: string, label?: TranslatableText, mode?: 'none' } | null
  landing: CampaignLanding | null
  email_text: CampaignEmailText | null
  commitments: number
  // People with a confirmed "notify me" request on this campaign, not yet told.
  waiting: number
  progress: PtGoalProgress
}

// The steps of the campaign setup wizard (PtCampaignSetupSteps).
export const PT_SETUP_STEPS = ['setup', 'languages', 'content', 'landing', 'publish'] as const
export type PtSetupStep = typeof PT_SETUP_STEPS[number]

// The last day of a campaign's dates: the day it ended once it has, else its end date.
export function ptCampaignEnd(c: Pick<PtCampaignSummary, 'end_mode' | 'end_date'> & { ended_at?: string | null, timezone?: string }): string | null {
  return campaignEndDate({ end_mode: c.end_mode, end_date: c.end_date, ended_at: c.ended_at ?? null, timezone: c.timezone ?? 'UTC' })
}

export function ptCampaignDates(c: PtCampaignSummary & { ended_at?: string | null, timezone?: string }): string {
  const start = ptFormatDate(c.start_date)
  const end = ptCampaignEnd(c)
  if (c.start_mode === 'join') return c.ended_at ? `Ended ${ptFormatDate(end)} · each person started on their own` : `From ${start} · each person finishes on their own`
  return `${start} – ${end ? ptFormatDate(end) : 'no end'}`
}

// Entries a campaign goes through, when its dates or length fix them.
export function ptCampaignEntries(c: Pick<SetupState, 'start_mode' | 'start_date' | 'end_mode' | 'end_date' | 'length_days' | 'cadence'>): number | null {
  if (c.start_mode === 'date' && c.end_mode === 'date' && c.start_date && c.end_date) return entryNumber(c.start_date, c.cadence, c.end_date)
  return c.end_mode === 'days' ? c.length_days : null
}

export function ptAnswersLine(c: PtCampaignSummary): string {
  return [
    c.start_mode === 'join' ? 'Starts when each person joins' : 'Starts on a date',
    c.end_mode === 'days' ? (c.length_days ? `${ptPlural(c.length_days, ptUnit(c.cadence), `${ptUnit(c.cadence)}s`)} each` : 'All the content') : c.end_mode === 'none' ? 'No end' : 'Ends on a date',
    PT_LABELS.goal[c.goal],
    PT_LABELS.cadence[c.cadence]
  ].filter(Boolean).join(' · ')
}

export function ptGoalText(p: PtGoalProgress): string | null {
  if (p.goal === 'people') return p.target ? `${p.people.toLocaleString()} of ${p.target.toLocaleString()} people` : null
  if (p.goal === 'prayer_time') return `${ptHours(p.value)} of ${ptHours(p.target ?? 1440)} of prayer a day`
  return `${p.percent ?? 0}% of the day and night covered`
}

export const ptPlural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`

// A per-day amount of prayer: minutes while under an hour, otherwise hours to one decimal.
export const ptHours = (min: number) => min > 0 && min < 60
  ? ptPlural(min, 'minute', 'minutes')
  : ptPlural(Math.round(min / 6) / 10, 'hour', 'hours')

export const ptUnit = (cadence: string) => cadence === 'monthly' ? 'month' : cadence === 'weekly' ? 'week' : 'day'
export const ptUnitTitle = (cadence: string) => cadence === 'monthly' ? 'Month' : cadence === 'weekly' ? 'Week' : 'Day'

// The months a monthly campaign can start in, each as its 1st: this month and
// the two years after it, and the campaign's own start month when outside them.
export function ptStartMonthItems(current: string | null, today: string): { value: string, label: string }[] {
  const thisMonth = `${today.slice(0, 8)}01`
  const months = Array.from({ length: 24 }, (_, i) => addMonths(thisMonth, i))
  const own = current ? `${current.slice(0, 8)}01` : null
  if (own && !months.includes(own)) months.push(own)
  return months.sort().map(m => ({ value: m, label: ptFormatDate(m, { month: 'long', year: 'numeric' }) }))
}

// The PT_LABELS.monthDay key of a monthly prayer time.
export const ptMonthDayKey = (c: { day_of_month?: number | null, days_of_week?: number[] }) => c.day_of_month ? `d${c.day_of_month}` : `w${c.days_of_week?.[0] ?? 0}`
