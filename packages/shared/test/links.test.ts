import { describe, expect, it } from 'vitest'
import { leaveToken, leaveUrl, parseLink, unsubscribeToken } from '../src/links'

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
