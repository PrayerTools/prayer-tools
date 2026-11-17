import { describe, expect, it } from 'vitest'
import { leaveToken, leaveUrl, parseLink, parsePersonalToken, personalToken, unsubscribeToken } from '../src/links'

describe('leave-campaign links', () => {
  it('round-trips the subscription, site and campaign', () => {
    const token = leaveToken('org-1', 'sub-1', 'camp-1')
    expect(parseLink(token, 'l')).toMatchObject({ orgId: 'org-1', subscriptionId: 'sub-1', campaignId: 'camp-1' })
    expect(leaveUrl('https://beirut.prayer.tools', 'org-1', 'sub-1', 'camp-1')).toBe(`https://beirut.prayer.tools/l/${token}`)
  })

  it('is not accepted as another kind of link, nor another kind as it', () => {
    expect(parseLink(leaveToken('org-1', 'sub-1', 'camp-1'), 'u')).toBeNull()
    expect(parseLink(unsubscribeToken('org-1', 'sub-1'), 'l')).toBeNull()
  })

  it('rejects a token whose campaign was swapped', () => {
    const signature = leaveToken('org-1', 'sub-1', 'camp-1').split('.')[1]
    const other = leaveToken('org-1', 'sub-1', 'camp-2').split('.')[0]
    expect(parseLink(`${other}.${signature}`, 'l')).toBeNull()
  })
})

describe('personal tokens', () => {
  const org = '1f37fe17-a34d-441d-8e60-2640dc3bd34a'
  const sub = '19ca2779-27eb-4290-8902-5c02e185cae5'

  it('round-trips the subscription in under 50 characters', () => {
    const token = personalToken(org, sub)
    expect(token.length).toBeLessThan(50)
    expect(parsePersonalToken(token, org)).toBe(sub)
  })

  it('is refused on another site or when tampered with', () => {
    const token = personalToken(org, sub)
    expect(parsePersonalToken(token, '00000000-0000-0000-0000-000000000000')).toBeNull()
    const [, sig] = token.split('.')
    const other = personalToken(org, '00000000-0000-0000-0000-000000000001').split('.')[0]
    expect(parsePersonalToken(`${other}.${sig}`, org)).toBeNull()
    expect(parsePersonalToken(unsubscribeToken(org, sub), org)).toBeNull()
  })
})
