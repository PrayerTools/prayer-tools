import { describe, expect, it } from 'vitest'
import { prayerTimeLines, welcomeEmail, type SiteMailContext } from '../src/email/templates'

const ctx: SiteMailContext = {
  orgId: 'o1', slug: 'beirut', siteName: 'Pray for Beirut', siteUrl: 'https://beirut.prayer.tools', color: '#2f6f5e', textOnColor: '#ffffff',
  logoUrl: null, fromName: 'Pray for Beirut', fromLocal: 'beirut', replyTo: null, signature: {}, defaultLanguage: 'en'
}

const details = {
  campaignName: 'Ramadan 2027',
  name: 'Sam',
  startsOn: null,
  times: ['Every day at 7:00 AM (Asia/Beirut) · 15 minutes'],
  prayUrl: 'https://beirut.prayer.tools/pray#p=x',
  calendarUrl: 'https://beirut.prayer.tools/ics/x.ics',
  shareUrl: 'https://beirut.prayer.tools/?r=abc123',
  manageUrl: 'https://beirut.prayer.tools/m/x',
  unsubscribeUrl: 'https://beirut.prayer.tools/u/x'
}

describe('prayerTimeLines', () => {
  it('describes daily and weekly times with their timezone and length', () => {
    const lines = prayerTimeLines([
      { kind: 'recurring', frequency: 'daily', days_of_week: [], time: '07:00:00', timezone: 'Asia/Beirut', duration_min: 15, dates: [] },
      { kind: 'recurring', frequency: 'weekly', days_of_week: ['4', '1'], time: '19:30', timezone: 'UTC', duration_min: null, dates: [] }
    ], 'en')
    expect(lines).toEqual(['Every day at 7:00 AM (Asia/Beirut) · 15 minutes', 'Monday and Thursday at 7:30 PM (UTC)'])
  })

  it('lists chosen dates in order, capped with a count of the rest', () => {
    const dates = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2027, 1, 12 - i, 6)))
    const lines = prayerTimeLines([{ kind: 'dates', frequency: null, days_of_week: [], time: '06:00', timezone: 'UTC', duration_min: 60, dates }], 'en')
    expect(lines).toHaveLength(11)
    expect(lines[0]).toBe('Feb 1, 2027, 6:00 AM (UTC) · 60 minutes')
    expect(lines[10]).toBe('and 2 more')
  })
})

describe('welcomeEmail', () => {
  it('greets the person and carries their times and links', () => {
    const r = welcomeEmail(ctx, 'en', details)
    expect(r.subject).toBe('Welcome to Pray for Beirut')
    expect(r.html).toContain('Welcome, Sam!')
    expect(r.html).toContain('<li>Every day at 7:00 AM (Asia/Beirut) · 15 minutes</li>')
    for (const url of [details.prayUrl, details.calendarUrl, details.shareUrl, details.manageUrl, details.unsubscribeUrl]) {
      expect(r.html).toContain(url)
      expect(r.text).toContain(url)
    }
  })

  it('says when the campaign starts and translates', () => {
    const r = welcomeEmail(ctx, 'es', { ...details, name: null, startsOn: '2027-02-08', shareUrl: null })
    expect(r.subject).toBe('Bienvenido a Pray for Beirut')
    expect(r.html).toContain('¡Bienvenido!')
    expect(r.text).toContain('La campaña comienza el 8 de febrero de 2027.')
    expect(r.text).not.toContain('?r=')
  })
})
