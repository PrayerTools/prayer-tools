import { describe, expect, it } from 'vitest'
import { applyTemplate, campaignLength, campaignStatus, campaignsOverlap, defaultDuration, displayLength, durationOptions, durationRule, overlappingCampaign, pickCurrentCampaign, slotMinutes, suggestCampaignSlug, suggestSideSlug, validateSetup, type CampaignDates } from '../src/setup'

const NY = 'America/New_York'

function c(p: Partial<CampaignDates> & { id?: string, kind?: 'side' | null }): CampaignDates & { id: string, kind?: 'side' | null } {
  return { id: p.id ?? 'x', start_mode: 'date', start_date: '2026-03-01', end_mode: 'date', end_date: '2026-03-30', length_days: null, cadence: 'daily', timezone: NY, ended_at: null, ...p }
}

describe('displayLength', () => {
  it('shared-calendar campaigns ending within 50 days are fixed', () => {
    expect(displayLength(c({ start_date: '2026-03-01', end_date: '2026-04-20' }))).toBe('fixed')
    expect(displayLength(c({ start_date: '2026-03-01', end_date: '2026-04-21' }))).toBe('ongoing')
    expect(displayLength(c({ end_mode: 'none', end_date: null }))).toBe('ongoing')
    expect(displayLength(c({ start_mode: 'join', start_date: null, end_mode: 'days', end_date: null, length_days: 7 }))).toBe('ongoing')
  })
})

describe('campaignStatus', () => {
  it('follows the dates in the campaign timezone', () => {
    const k = c({ start_date: '2026-03-01', end_date: '2026-03-30' })
    // 04:30 UTC on 1 March is still 28 February in New York.
    expect(campaignStatus(k, new Date('2026-03-01T04:30:00Z'))).toBe('upcoming')
    expect(campaignStatus(k, new Date('2026-03-01T05:30:00Z'))).toBe('active')
    expect(campaignStatus(k, new Date('2026-03-31T03:30:00Z'))).toBe('active')
    expect(campaignStatus(k, new Date('2026-03-31T04:30:00Z'))).toBe('ended')
  })

  it('ended_at ends it; personal-start and open-ended campaigns stay active', () => {
    expect(campaignStatus(c({ ended_at: new Date('2026-03-10') }), new Date('2026-03-05T12:00:00Z'))).toBe('ended')
    expect(campaignStatus(c({ start_mode: 'join', start_date: null, end_mode: 'days', end_date: null, length_days: 7 }), new Date('2030-01-01'))).toBe('active')
    expect(campaignStatus(c({ end_mode: 'none', end_date: null }), new Date('2030-01-01'))).toBe('active')
  })
})

describe('pickCurrentCampaign', () => {
  const now = new Date('2026-06-15T12:00:00Z')
  const past = c({ id: 'past', start_date: '2026-01-01', end_date: '2026-01-30' })
  const older = c({ id: 'older', start_date: '2025-01-01', end_date: '2025-01-30' })
  const active = c({ id: 'active', start_date: '2026-06-01', end_date: '2026-06-30' })
  const next = c({ id: 'next', start_date: '2026-08-01', end_date: '2026-08-30' })
  const later = c({ id: 'later', start_date: '2026-10-01', end_date: '2026-10-30' })

  it('prefers the active campaign', () => {
    expect(pickCurrentCampaign([past, next, active], now)).toEqual({ campaign: active, state: 'active' })
  })

  it('else the next upcoming one', () => {
    expect(pickCurrentCampaign([later, past, next], now)).toEqual({ campaign: next, state: 'upcoming' })
  })

  it('else the most recently ended one', () => {
    expect(pickCurrentCampaign([older, past], now)).toEqual({ campaign: past, state: 'between' })
    expect(pickCurrentCampaign([], now)).toBeNull()
  })

  it('never picks a side campaign', () => {
    const ongoing = c({ id: 'ongoing', start_date: '2025-01-01', end_mode: 'none', end_date: null })
    const ramadan = c({ id: 'ramadan', kind: 'side', start_date: '2026-06-10', end_date: '2026-07-09' })
    expect(pickCurrentCampaign([ongoing, ramadan], now)).toEqual({ campaign: ongoing, state: 'active' })
    expect(pickCurrentCampaign([past, ramadan], now)).toEqual({ campaign: past, state: 'between' })
    expect(pickCurrentCampaign([ramadan], now)).toBeNull()
  })
})

describe('side campaigns', () => {
  const ongoing = c({ id: 'ongoing', start_date: '2025-01-01', end_mode: 'none', end_date: null })
  const ramadan = c({ start_date: '2027-02-08', end_date: '2027-03-09' })

  it('overlap any campaign; main campaigns only clash with main campaigns', () => {
    expect(overlappingCampaign(ramadan, 'side', [ongoing])).toBeNull()
    expect(overlappingCampaign(ramadan, null, [ongoing])).toBe(ongoing)
    expect(overlappingCampaign(ramadan, null, [{ ...ramadan, id: 'other', kind: 'side' }])).toBeNull()
  })

  it('need a start date and an end date', () => {
    const answers = { start_mode: 'date', start_date: '2027-02-08', end_mode: 'date', end_date: '2027-03-09', length_days: null, goal: 'people', cadence: 'daily', track_time: false } as const
    expect(validateSetup(answers, 'side')).toEqual([])
    expect(validateSetup({ ...answers, end_mode: 'none', end_date: null }, 'side')).toContain('end_mode')
    expect(validateSetup({ ...answers, end_mode: 'none', end_date: null })).toEqual([])
  })

  it('take their address from the name', () => {
    expect(suggestSideSlug('Ramadan 2027', '2027-02-08', [])).toBe('ramadan-2027')
    expect(suggestSideSlug('Prière pour Haïti', '2026-09-01', [])).toBe('priere-pour-haiti-2026')
    expect(suggestSideSlug('Ramadan 2027', '2027-02-08', ['ramadan-2027'])).toBe('ramadan-2027-2')
    expect(suggestSideSlug('Pray', '2026-09-01', [])).toBe('pray-2026')
    expect(suggestSideSlug('Stats 2026', '2026-09-01', [])).toBe('stats-2026')
    expect(suggestSideSlug('…', '2026-09-01', [])).toBe('2026')
  })
})

describe('applyTemplate', () => {
  it('Ramadan: dates from the chosen start, 30 days, daily, people', () => {
    expect(applyTemplate('ramadan', { start_date: '2027-02-08' })).toEqual({
      start_mode: 'date', start_date: '2027-02-08', end_mode: 'date', end_date: '2027-03-09', length_days: null, goal: 'people', cadence: 'daily', track_time: false
    })
  })

  it('4-day disaster ends three days after the start', () => {
    expect(applyTemplate('disaster_4', { start_date: '2026-09-28' }).end_date).toBe('2026-10-01')
  })

  it('keeps the answers the champion changed from the template', () => {
    expect(applyTemplate('disaster_12', { start_date: '2027-02-08', end_date: '2027-02-19' }).end_date).toBe('2027-02-19')
    expect(applyTemplate('ramadan', { start_date: '2027-02-08', end_date: '2027-02-20', cadence: 'weekly' })).toMatchObject({ end_date: '2027-02-20', cadence: 'weekly' })
    expect(validateSetup(applyTemplate('disaster_12', { start_date: '2027-02-08', end_date: '2027-02-19' }), 'side')).toEqual([])
  })

  it('start anytime: personal start that follows the content, daily or weekly', () => {
    expect(applyTemplate('anytime', { length_days: 10, cadence: 'weekly' })).toEqual({
      start_mode: 'join', start_date: null, end_mode: 'days', end_date: null, length_days: 10, goal: 'people', cadence: 'weekly', track_time: false
    })
  })

  it('generic keeps choices and fixes contradictory end modes', () => {
    expect(applyTemplate('generic', { start_mode: 'join', end_mode: 'date', end_date: '2026-10-01', length_days: 5 })).toMatchObject({ start_mode: 'join', end_mode: 'days', end_date: null, start_date: null, length_days: 5 })
    expect(applyTemplate('generic', { start_mode: 'date', start_date: '2026-10-01', end_mode: 'days', length_days: 5 })).toMatchObject({ end_mode: 'date', length_days: null })
    expect(applyTemplate('unknown', { goal: 'coverage' }).goal).toBe('coverage')
  })

  it('validates the result', () => {
    expect(validateSetup(applyTemplate('ramadan', { start_date: '2027-02-08' }))).toEqual([])
    expect(validateSetup(applyTemplate('generic', { start_mode: 'date', start_date: '2026-10-01', end_date: '2026-09-01' }))).toEqual(['end_date'])
    expect(validateSetup(applyTemplate('anytime', {}))).toEqual([])
    expect(validateSetup(applyTemplate('generic', { start_mode: 'join', end_mode: 'days', length_days: 0 }))).toEqual(['length_days'])
  })

  it('24/7 coverage needs a start date and an end date', () => {
    expect(validateSetup(applyTemplate('generic', { goal: 'coverage', start_mode: 'date', start_date: '2026-10-01', end_mode: 'date', end_date: '2026-10-07' }))).toEqual([])
    expect(validateSetup(applyTemplate('generic', { goal: 'coverage', start_mode: 'date', start_date: '2026-10-01', end_mode: 'none' }))).toEqual(['goal'])
    expect(validateSetup(applyTemplate('generic', { goal: 'coverage', start_mode: 'join', end_mode: 'days' }))).toEqual(['goal'])
  })
})

describe('derived answers', () => {
  it('campaign length in entries', () => {
    expect(campaignLength(c({ start_date: '2026-03-01', end_date: '2026-03-30' }))).toBe(30)
    expect(campaignLength(c({ start_date: '2026-03-01', end_date: '2026-03-30', cadence: 'weekly' }))).toBe(5)
    expect(campaignLength(c({ start_mode: 'join', end_mode: 'days', length_days: 7 }))).toBe(7)
    expect(campaignLength(c({ start_mode: 'join', end_mode: 'days', length_days: null }))).toBeNull()
    expect(campaignLength(c({ end_mode: 'none', end_date: null }))).toBeNull()
  })

  it('duration asked by goal', () => {
    expect(durationRule('people', false)).toBe('hidden')
    expect(durationRule('people', true)).toBe('optional')
    expect(durationRule('coverage', false)).toBe('required')
  })

  it('24/7 durations are whole slots', () => {
    expect(slotMinutes({ goal: 'coverage', slot_min: null })).toBe(15)
    expect(durationOptions({ goal: 'coverage', slot_min: null })).toEqual([15, 30, 45, 60, 90, 120])
    expect(durationOptions({ goal: 'coverage', slot_min: 5 })).toEqual([5, 10, 15, 20, 30, 45, 60, 90, 120])
    expect(durationOptions({ goal: 'coverage', slot_min: 10 })).toEqual([10, 20, 30, 60, 90, 120])
    expect(durationOptions({ goal: 'coverage', slot_min: 60 })).toEqual([60, 120])
    expect(durationOptions({ goal: 'prayer_time', slot_min: 60 })).toContain(5)
    expect(defaultDuration({ goal: 'coverage', slot_min: 30 }, 15)).toBe(30)
    expect(defaultDuration({ goal: 'coverage', slot_min: 60 }, 200)).toBe(120)
    expect(defaultDuration({ goal: 'prayer_time', slot_min: 30 }, 15)).toBe(15)
  })

  it('overlap and slugs', () => {
    expect(campaignsOverlap(c({ end_date: '2026-03-30' }), c({ start_date: '2026-03-30', end_date: '2026-04-10' }))).toBe(true)
    expect(campaignsOverlap(c({ end_date: '2026-03-29' }), c({ start_date: '2026-03-30', end_date: '2026-04-10' }))).toBe(false)
    expect(suggestCampaignSlug('2026-03-01', ['2026'])).toBe('2026-2')
  })
})
