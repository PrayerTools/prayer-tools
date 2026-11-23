import { describe, expect, test } from 'bun:test'
import { parseMessage } from './messages'

describe('parseMessage', () => {
  test('current story format, after the champion mentions', () => {
    const m = parseMessage('stories', '@[Sam Lee](12), @[Ana Ruiz](40), \nYou received a Story feedback on https://demo.prayer.tools/ramadan/stats, submitted by friend@example.com: \n\nGod answered our prayer.\nThank you!')
    expect(m).toEqual({ kind: 'story', email: 'friend@example.com', valid: true, name: null, body: 'God answered our prayer.\nThank you!' })
  })

  test('older story format', () => {
    expect(parseMessage('stories', 'Story feedback from https://demo.prayer.tools/stats by friend@example.com: We prayed every day.'))
      .toEqual({ kind: 'story', email: 'friend@example.com', valid: true, name: null, body: 'We prayed every day.' })
  })

  test('current contact format keeps the name', () => {
    const m = parseMessage('contact_us', '@[Sam Lee](12), \nJo Doe (jo@example.com) filled out the Contact Us form (https://demo.prayer.tools/ramadan/contact-us) on your campaign. Here is what they said:\n\nCan my church join?')
    expect(m).toEqual({ kind: 'contact', email: 'jo@example.com', valid: true, name: 'Jo Doe', body: 'Can my church join?' })
  })

  test('older contact format', () => {
    expect(parseMessage('contact_us', 'Message on [Contact Us](https://demo.prayer.tools/contact-us) by Jo D jo@example.com: Hello there'))
      .toEqual({ kind: 'contact', email: 'jo@example.com', valid: true, name: 'Jo D', body: 'Hello there' })
    expect(parseMessage('contact_us', 'Message on Contact Us by Jo D jo@example.com: \nHello there'))
      .toEqual({ kind: 'contact', email: 'jo@example.com', valid: true, name: 'Jo D', body: 'Hello there' })
  })

  test('keeps a shortened address for the importer to match', () => {
    expect(parseMessage('stories', 'Story feedback from https://x.prayer.tools/stats by ann@yahoo: \nThanks'))
      .toEqual({ kind: 'story', email: 'ann@yahoo', valid: false, name: null, body: 'Thanks' })
  })

  test('decodes HTML and rejects unknown formats or empty messages', () => {
    expect(parseMessage('stories', 'You received a Story feedback on https://x.prayer.tools/stats, submitted by a@example.com: <p>Tom &amp; Ann&#039;s story</p>')?.body).toBe('Tom & Ann\'s story')
    expect(parseMessage('stories', 'Something else entirely')).toBeNull()
    expect(parseMessage('contact_us', 'Jo (jo@example.com) filled out the Contact Us form (https://x) on your campaign. Here is what they said:\n\n  ')).toBeNull()
  })
})
