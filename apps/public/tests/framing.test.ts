import { describe, expect, test } from 'bun:test'
import { frameHeaders } from '../server/lib/framing'

const ADMIN = 'https://admin.prayer.tools'

describe('frameHeaders', () => {
  test('any website may frame the embed widget', () => {
    expect(frameHeaders('embed', ADMIN)).toEqual({ 'content-security-policy': 'frame-ancestors *', 'x-frame-options': null })
  })

  test('only the admin app frames a page opened by its editor', () => {
    expect(frameHeaders('editor', ADMIN)).toEqual({ 'content-security-policy': `frame-ancestors ${ADMIN}`, 'x-frame-options': null })
  })

  test('every other page refuses other sites', () => {
    expect(frameHeaders('page', ADMIN)).toEqual({ 'content-security-policy': "frame-ancestors 'self'", 'x-frame-options': 'SAMEORIGIN' })
  })
})
