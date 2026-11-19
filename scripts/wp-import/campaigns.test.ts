import { describe, expect, test } from 'bun:test'
import { emptyOverlaps, type CampaignPlan } from './campaigns'

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
