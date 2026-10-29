import { expect, test } from 'bun:test'
import { campaignDateError } from '../apps/prayertools/app/utils/pt-setup-validation'

const dates = { start_mode: 'date', end_mode: 'date', start_date: '2027-04-01', end_date: '2027-03-31' }
test('explains an end date before the start date', () => {
  expect(campaignDateError(dates)).toContain('end date cannot be before the start date')
})
test('allows a one-day campaign and a later end date', () => {
  expect(campaignDateError({ ...dates, end_date: '2027-04-01' })).toBeUndefined()
  expect(campaignDateError({ ...dates, end_date: '2027-05-01' })).toBeUndefined()
})
test('ignores dates for personal-start and ongoing campaigns', () => {
  expect(campaignDateError({ ...dates, start_mode: 'join' })).toBeUndefined()
  expect(campaignDateError({ ...dates, end_mode: 'none' })).toBeUndefined()
  expect(campaignDateError({ ...dates, end_date: null })).toBeUndefined()
})
