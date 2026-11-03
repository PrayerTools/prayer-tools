import { describe, expect, it } from 'vitest'
import { campaignEditMissing } from '../src/campaigns'

const editor = new Set(['pt.campaigns.write', 'pt.messages.write', 'pt.site.write'])
const mobilizer = new Set(['pt.site.read', 'pt.messages.write'])
const viewer = new Set(['pt.site.read'])

describe('campaignEditMissing', () => {
  it('lets message writers edit share and end-of-campaign messages', () => {
    expect(campaignEditMissing(['share'], mobilizer)).toBeNull()
    expect(campaignEditMissing(['share_image_url'], mobilizer)).toBeNull()
    expect(campaignEditMissing(['end_message', 'cta'], mobilizer)).toBeNull()
  })

  it('rejects message writers sending any other field', () => {
    expect(campaignEditMissing(['end_message', 'name'], mobilizer)).toBe('pt.campaigns.write')
    expect(campaignEditMissing(['start_date'], mobilizer)).toBe('pt.campaigns.write')
    expect(campaignEditMissing(['landing'], mobilizer)).toBe('pt.campaigns.write')
  })

  it('lets campaign writers edit messages without the messages permission', () => {
    expect(campaignEditMissing(['share', 'name'], new Set(['pt.campaigns.write']))).toBeNull()
  })

  it('needs site write for landing page fields', () => {
    expect(campaignEditMissing(['description'], new Set(['pt.campaigns.write']))).toBe('pt.site.write')
    expect(campaignEditMissing(['landing', 'branding', 'description'], editor)).toBeNull()
  })

  it('rejects callers without either write permission, even with an empty edit', () => {
    expect(campaignEditMissing([], viewer)).toBe('pt.campaigns.write')
    expect(campaignEditMissing(['share'], viewer)).toBe('pt.campaigns.write')
  })
})
