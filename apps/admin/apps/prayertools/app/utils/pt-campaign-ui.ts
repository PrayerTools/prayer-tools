// Display helpers shared by the campaign list and campaign pages.
import type { CampaignLanding, TranslatableText } from '@prayertools/shared/db/schema'
import type { SitePlaceWording } from '@prayertools/shared/place'
import type { SetupState } from '../components/PtSetupForm.vue'

export type PtCampaignSummary = Pick<SetupState, 'start_mode' | 'start_date' | 'end_mode' | 'end_date' | 'length_days' | 'goal' | 'cadence'>

export const PT_CADENCE_ITEMS = [
  { value: 'daily', label: 'Daily', description: 'A new prayer entry every day.' },
  { value: 'weekly', label: 'Weekly', description: 'A new prayer entry every week.' }
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
  cta: { url?: string, label?: TranslatableText } | null
  landing: CampaignLanding | null
  commitments: number
  progress: PtGoalProgress
}

export function ptCampaignDates(c: PtCampaignSummary): string {
  const start = ptFormatDate(c.start_date)
  if (c.start_mode === 'join') return `From ${start} · each person finishes on their own`
  return `${start} – ${c.end_mode === 'date' && c.end_date ? ptFormatDate(c.end_date) : 'no end'}`
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
  if (p.goal === 'prayer_time') return `${p.value.toLocaleString()} of ${(p.target ?? 1440).toLocaleString()} minutes of prayer a day`
  return `${p.percent ?? 0}% of the day and night covered`
}

export const ptPlural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`

export const ptUnit = (cadence: string) => cadence === 'weekly' ? 'week' : 'day'
