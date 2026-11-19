import { describe, expect, test } from 'bun:test'
import { campaignColor, emptyOverlaps, siteColor, type CampaignPlan } from './campaigns'

const plan = (wpId: number, overlaps?: number) => ({ wpId, overlaps }) as CampaignPlan
const use = (entries: [number, number, number][]) => new Map(entries.map(([id, subscribers, fuel]) => [id, { subscribers, fuel }]))

describe('emptyOverlaps', () => {
  test('drops the empty one of two overlapping campaigns', () => {
    expect(emptyOverlaps([plan(3), plan(5, 3)], use([[3, 4, 0], [5, 0, 0]]), 3)).toEqual(new Set([5]))
    expect(emptyOverlaps([plan(3), plan(6, 3)], use([[3, 0, 0], [6, 0, 8]]), 6)).toEqual(new Set([3]))
  })

  test('keeps the home campaign WordPress showed when all are empty', () => {
    expect(emptyOverlaps([plan(4), plan(9, 4)], use([]), 9)).toEqual(new Set([4]))
    expect(emptyOverlaps([plan(4), plan(9, 4)], use([]), 4)).toEqual(new Set([9]))
  })

  test('keeps campaigns that have subscribers or content, and those not overlapping', () => {
    expect(emptyOverlaps([plan(1), plan(2, 1), plan(7)], use([[1, 43, 0], [2, 3, 34]]), 2)).toEqual(new Set())
  })
})

describe('campaign colors', () => {
  const meta = (entries: Record<string, string>) => new Map(Object.entries(entries).map(([k, v]) => [k, [v]]))
  const colored = (wpId: number, color: string | null, startDate: string, kind: string | null = null) => ({ wpId, color, startDate, kind }) as CampaignPlan

  test('a custom color wins over the preset theme, and the default theme is no color', () => {
    expect(campaignColor(meta({ custom_theme_color: '#8E4585', theme_color: 'teal' }))).toBe('#8e4585')
    expect(campaignColor(meta({ theme_color: 'forestgreen' }))).toBe('#1eb858')
    expect(campaignColor(meta({ theme_color: 'preset' }))).toBeNull()
    expect(campaignColor(undefined)).toBeNull()
  })

  test('the site takes its home campaign color, else the most recent main campaign with one', () => {
    const plans = [colored(939, '#193043', '2024-03-10'), colored(1310, '#008533', '2026-02-18'), colored(1584, '#8e4585', '2025-01-01'), colored(2000, '#111111', '2027-01-01', 'side')]
    expect(siteColor(plans, 1584)).toBe('#8e4585')
    expect(siteColor(plans, 0)).toBe('#008533')
    expect(siteColor([colored(5, null, '2025-01-01'), colored(6, '#222222', '2024-01-01')], 5)).toBeNull()
  })
})
