// Campaign setup: the four answers (start, end, goal, cadence), the templates
// that pre-fill them, and everything that follows from them (length, status,
// which commitment fields are asked). Options and defaults live here; a
// campaign stores its answers.
import type { Cadence, CampaignKind, EndMode, Goal, StartMode } from './db/schema'
import { addDays, daysBetween, isIsoDate, todayIn } from './dates'
import { campaignSlugError } from './paths'

export const START_MODES: readonly StartMode[] = ['date', 'join']
export const END_MODES: readonly EndMode[] = ['date', 'none', 'days']
export const GOALS: readonly Goal[] = ['people', 'prayer_time', 'coverage']
export const CADENCES: readonly Cadence[] = ['daily', 'weekly']

export const FIXED_MAX_DAYS = 50
export const DEFAULT_DURATION_MIN = 15
export const DURATION_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120]
export const SLOT_OPTIONS = [5, 10, 15, 30, 60]
export const DEFAULT_SLOT_MIN = 15

export interface SetupAnswers {
  start_mode: StartMode
  start_date: string | null
  end_mode: EndMode
  end_date: string | null
  length_days: number | null
  goal: Goal
  cadence: Cadence
  track_time: boolean
}

export const SETUP_DEFAULTS: SetupAnswers = {
  start_mode: 'date',
  start_date: null,
  end_mode: 'date',
  end_date: null,
  length_days: null,
  goal: 'people',
  cadence: 'daily',
  track_time: false
}

export interface CampaignTemplate {
  key: string
  // Pre-filled answers. `length_days` with a date start becomes an end date
  // `length_days - 1` days after the chosen start.
  setup: Partial<SetupAnswers>
  // Answers the champion still picks (shown unlocked in the setup form).
  open: (keyof SetupAnswers)[]
  // Library topics suggested first in the catalog.
  topics: string[]
  // Landing sections shown by default (the rest start hidden).
  hiddenSections: string[]
  // Default end-of-campaign call to action kind.
  cta: 'none' | 'next_campaign'
}

export const TEMPLATES: readonly CampaignTemplate[] = [
  {
    key: 'generic',
    setup: {},
    open: ['start_mode', 'start_date', 'end_mode', 'end_date', 'length_days', 'goal', 'cadence', 'track_time'],
    topics: [],
    hiddenSections: [],
    cta: 'none'
  },
  {
    key: 'ramadan',
    setup: { start_mode: 'date', end_mode: 'date', length_days: 30, goal: 'people', cadence: 'daily' },
    open: ['start_date', 'goal', 'track_time'],
    topics: ['ramadan'],
    hiddenSections: [],
    cta: 'none'
  },
  {
    key: 'disaster_4',
    setup: { start_mode: 'date', end_mode: 'date', length_days: 4, goal: 'people', cadence: 'daily' },
    open: ['start_date', 'goal', 'track_time'],
    topics: ['crisis'],
    hiddenSections: ['stories'],
    cta: 'next_campaign'
  },
  {
    key: 'disaster_12',
    setup: { start_mode: 'date', end_mode: 'date', length_days: 12, goal: 'people', cadence: 'daily' },
    open: ['start_date', 'goal', 'track_time'],
    topics: ['crisis'],
    hiddenSections: [],
    cta: 'none'
  },
  {
    key: 'anytime',
    setup: { start_mode: 'join', end_mode: 'days', length_days: null, goal: 'people', cadence: 'daily' },
    open: ['cadence', 'goal', 'track_time'],
    topics: [],
    hiddenSections: [],
    cta: 'none'
  }
]

export function getTemplate(key: string | null | undefined): CampaignTemplate {
  return TEMPLATES.find(t => t.key === key) ?? TEMPLATES[0]!
}

// Expected first days of Ramadan (the start can shift a day with the moon).
export const RAMADAN_START_DATES = [
  '2026-02-18', '2027-02-08', '2028-01-28', '2029-01-16', '2030-01-05',
  '2030-12-26', '2031-12-15', '2032-12-04', '2033-11-23', '2034-11-12'
] as const

// Start date a template suggests, on or after `today`; null when it has none.
export function suggestedStartDate(key: string, today: string): string | null {
  if (key !== 'ramadan') return null
  return RAMADAN_START_DATES.find(d => d >= today) ?? null
}

// Fills a template's answers around what the champion chose.
export function applyTemplate(key: string, chosen: Partial<SetupAnswers>): SetupAnswers {
  const t = getTemplate(key)
  const merged: SetupAnswers = { ...SETUP_DEFAULTS, ...t.setup }
  for (const k of t.open) {
    if (chosen[k] !== undefined) (merged as unknown as Record<string, unknown>)[k] = chosen[k]
  }
  if (merged.start_mode === 'date' && merged.end_mode === 'date' && !chosen.end_date && t.setup.length_days && merged.start_date) {
    merged.end_date = addDays(merged.start_date, t.setup.length_days - 1)
  }
  if (merged.start_mode === 'date' && merged.end_mode === 'days') merged.end_mode = 'date'
  if (merged.start_mode === 'join' && merged.end_mode === 'date') merged.end_mode = 'days'
  if (merged.end_mode !== 'days') merged.length_days = null
  if (merged.end_mode !== 'date') merged.end_date = null
  if (merged.start_mode === 'join') merged.start_date = null
  return merged
}

export function validateSetup(a: SetupAnswers, kind: CampaignKind | null = null): string[] {
  const errors: string[] = []
  // Side campaigns run on fixed dates beside the main campaign.
  if (kind === 'side' && (a.start_mode !== 'date' || a.end_mode !== 'date')) errors.push('end_mode')
  if (!START_MODES.includes(a.start_mode)) errors.push('start_mode')
  if (!END_MODES.includes(a.end_mode)) errors.push('end_mode')
  if (!GOALS.includes(a.goal)) errors.push('goal')
  if (!CADENCES.includes(a.cadence)) errors.push('cadence')
  if (a.start_mode === 'date' && !isIsoDate(a.start_date)) errors.push('start_date')
  if (a.start_mode === 'date' && a.end_mode === 'days') errors.push('end_mode')
  if (a.start_mode === 'join' && a.end_mode === 'date') errors.push('end_mode')
  if (a.end_mode === 'date') {
    if (!isIsoDate(a.end_date)) errors.push('end_date')
    else if (a.start_date && a.end_date < a.start_date) errors.push('end_date')
  }
  // Coverage is a grid over fixed dates; open-ended campaigns aim for prayer time.
  if (a.goal === 'coverage' && (a.start_mode !== 'date' || a.end_mode !== 'date')) errors.push('goal')
  if (a.end_mode === 'days' && a.length_days !== null && !(Number.isInteger(a.length_days) && a.length_days >= 1 && a.length_days <= 3650)) {
    errors.push('length_days')
  }
  return errors
}

// ── Derived from the answers ───────────────────────────────────────────────

export interface CampaignDates {
  start_mode: StartMode
  start_date: string | null
  end_mode: EndMode
  end_date: string | null
  length_days: number | null
  cadence: Cadence
  timezone: string
  ended_at?: Date | string | null
}

// A shared-calendar campaign ending within 50 days of its start is fixed;
// anything longer, open-ended or personal-start is ongoing.
export function displayLength(c: CampaignDates): 'fixed' | 'ongoing' {
  if (c.start_mode === 'date' && c.end_mode === 'date' && c.start_date && c.end_date) {
    return daysBetween(c.start_date, c.end_date) <= FIXED_MAX_DAYS ? 'fixed' : 'ongoing'
  }
  return 'ongoing'
}

export type CampaignStatus = 'upcoming' | 'active' | 'ended'

export function campaignStatus(c: CampaignDates, now: Date = new Date()): CampaignStatus {
  if (c.ended_at) return 'ended'
  const today = todayIn(c.timezone, now)
  if (c.start_mode === 'date' && c.start_date && today < c.start_date) return 'upcoming'
  if (c.end_mode === 'date' && c.end_date && today > c.end_date) return 'ended'
  return 'active'
}

// Number of entries in the campaign's content sequence, when bounded. A
// personal-start campaign without a length follows its content (see
// `campaignEntries` in content.ts).
export function campaignLength(c: CampaignDates): number | null {
  if (c.end_mode === 'days') return c.length_days
  if (c.end_mode === 'date' && c.start_date && c.end_date) {
    const days = daysBetween(c.start_date, c.end_date) + 1
    return c.cadence === 'weekly' ? Math.ceil(days / 7) : days
  }
  return null
}

// What a commitment asks for, by goal.
export function durationRule(goal: Goal, trackTime: boolean): 'required' | 'optional' | 'hidden' {
  if (goal === 'people') return trackTime ? 'optional' : 'hidden'
  return 'required'
}

export interface CampaignSlots {
  goal: Goal
  slot_min?: number | null
}

// Length of one 24/7 coverage slot in minutes.
export function slotMinutes(c: CampaignSlots): number {
  return c.slot_min ?? DEFAULT_SLOT_MIN
}

// Prayer lengths a commitment may choose: on 24/7 campaigns whole slots only,
// so every commitment fills complete cells of the coverage grid.
export function durationOptions(c: CampaignSlots): number[] {
  if (c.goal !== 'coverage') return [...DURATION_OPTIONS]
  const slot = slotMinutes(c)
  return DURATION_OPTIONS.filter(d => d >= slot && d % slot === 0)
}

// The site's default prayer length; on 24/7 campaigns moved up to the nearest
// whole number of slots.
export function defaultDuration(c: CampaignSlots, siteDefault: number): number {
  if (c.goal !== 'coverage') return siteDefault
  const options = durationOptions(c)
  return options.find(d => d >= siteDefault) ?? options[options.length - 1]!
}

export interface CampaignLike extends CampaignDates {
  id: string
  kind?: CampaignKind | null
  created_at?: Date | string
}

// A side campaign runs beside the main campaign at its own address
// (`/ramadan-2027`) and never takes the site's root address.
export function isSideCampaign(c: { kind?: CampaignKind | null }): boolean {
  return c.kind === 'side'
}

// The site's current campaign, from its main campaigns: the active one, else
// the next upcoming one (signup opens before the start), else the most recent
// ended one (the site is between campaigns).
export function pickCurrentCampaign<T extends CampaignLike>(campaigns: T[], now: Date = new Date()): { campaign: T, state: 'upcoming' | 'active' | 'between' } | null {
  const withStatus = campaigns.filter(c => !isSideCampaign(c)).map(c => ({ c, s: campaignStatus(c, now) }))
  const active = withStatus.filter(x => x.s === 'active')
  if (active.length) {
    active.sort((a, b) => (b.c.start_date ?? '').localeCompare(a.c.start_date ?? ''))
    return { campaign: active[0]!.c, state: 'active' }
  }
  const upcoming = withStatus.filter(x => x.s === 'upcoming').sort((a, b) => (a.c.start_date ?? '').localeCompare(b.c.start_date ?? ''))
  if (upcoming.length) return { campaign: upcoming[0]!.c, state: 'upcoming' }
  const ended = withStatus.filter(x => x.s === 'ended').sort((a, b) => endKey(b.c).localeCompare(endKey(a.c)))
  if (ended.length) return { campaign: ended[0]!.c, state: 'between' }
  return null
}

function endKey(c: CampaignLike): string {
  return c.end_date ?? (c.ended_at ? new Date(c.ended_at).toISOString().slice(0, 10) : '')
}

// Main campaign date ranges on one site may not overlap, so the site's root
// address always shows one campaign. Personal-start campaigns and open-ended
// ones occupy everything from their start onwards.
export function campaignsOverlap(a: CampaignDates, b: CampaignDates): boolean {
  if (a.ended_at || b.ended_at) return false
  const range = (c: CampaignDates): [string, string] => [
    c.start_date ?? '0000-01-01',
    c.end_mode === 'date' && c.end_date ? c.end_date : '9999-12-31'
  ]
  const [as, ae] = range(a)
  const [bs, be] = range(b)
  return as <= be && bs <= ae
}

// The main campaign a new or edited campaign's dates would clash with. Side
// campaigns may overlap any campaign.
export function overlappingCampaign<T extends CampaignLike>(dates: CampaignDates, kind: CampaignKind | null, others: T[]): T | null {
  if (kind === 'side') return null
  return others.find(o => !isSideCampaign(o) && campaignsOverlap(dates, o)) ?? null
}

// URL slug for a new campaign: the start year, suffixed when already taken.
export function suggestCampaignSlug(startDate: string | null, taken: string[], now: Date = new Date()): string {
  const base = (startDate ?? now.toISOString()).slice(0, 4)
  if (!taken.includes(base)) return base
  for (let i = 2; i < 100; i++) {
    const s = `${base}-${i}`
    if (!taken.includes(s)) return s
  }
  return `${base}-${Date.now()}`
}

// URL slug for a new side campaign, from its name: `Ramadan 2027` becomes
// `ramadan-2027`; a name without a year gets the start year.
export function suggestSideSlug(name: string, startDate: string | null, taken: string[], now: Date = new Date()): string {
  const year = (startDate ?? now.toISOString()).slice(0, 4)
  let base = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '')
  if (!/\d{4}/.test(base)) base = base ? `${base}-${year}` : year
  if (campaignSlugError(base)) base = `${base}-${year}`
  if (!taken.includes(base)) return base
  for (let i = 2; i < 100; i++) {
    const s = `${base}-${i}`
    if (!taken.includes(s)) return s
  }
  return `${base}-${Date.now()}`
}
