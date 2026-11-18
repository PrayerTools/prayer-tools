import { describe, expect, it } from 'vitest'
import { reminderEmail, welcomeEmail, type ReminderDetails, type SiteMailContext, type WelcomeDetails } from '../src/email/templates'
import type { CampaignEmailText, TiptapDoc } from '../src/db/schema'

const ctx: SiteMailContext = {
  orgId: 'o1', slug: 'beirut', siteName: 'Pray for Beirut', siteUrl: 'https://beirut.prayer.tools', color: '#2f6f5e', textOnColor: '#ffffff',
  logoUrl: null, fromName: 'Pray for Beirut', fromLocal: 'beirut', replyTo: null, signature: {}, defaultLanguage: 'en'
}

const welcome: WelcomeDetails = {
  campaignName: 'Ramadan 2027',
  name: 'Sam',
  startsOn: null,
  times: ['Every day at 7:00 AM (Asia/Beirut) · 15 minutes'],
  prayUrl: 'https://beirut.prayer.tools/pray#p=x',
  calendarUrl: null,
  shareUrl: null,
  manageUrl: 'https://beirut.prayer.tools/m/x',
  unsubscribeUrl: 'https://beirut.prayer.tools/u/x',
  emailText: null
}

const reminder: ReminderDetails = {
  campaignName: 'Ramadan 2027',
  cadence: 'daily',
  day: 3,
  minutes: 15,
  prayUrl: 'https://beirut.prayer.tools/pray/3#p=x',
  manageUrl: 'https://beirut.prayer.tools/m/x',
  unsubscribeUrl: 'https://beirut.prayer.tools/u/x',
  leaveUrl: 'https://beirut.prayer.tools/l/x',
  emailText: null
}

const doc = (text: string): TiptapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

const text: CampaignEmailText = {
  tagline: { source: 'en', values: { en: 'Thank you for joining us!', es: '¡Gracias por unirte!' }, stale: [] },
  welcome: { en: doc('Read the guide before day one.'), es: doc('Lee la guía antes del primer día.') },
  reminder: { en: doc('Pray for the families of the city.'), es: doc('Ora por las familias de la ciudad.') }
}

describe('campaign email text', () => {
  it('puts the tagline after the greeting and the note after the prayer times', () => {
    const r = welcomeEmail(ctx, 'en', { ...welcome, emailText: text })
    const at = (s: string) => r.html.indexOf(s)
    expect(at('Welcome, Sam!')).toBeLessThan(at('Thank you for joining us!'))
    expect(at('Thank you for joining us!')).toBeLessThan(at('<li>Every day'))
    expect(at('<li>Every day')).toBeLessThan(at('Read the guide before day one.'))
    expect(at('Read the guide before day one.')).toBeLessThan(at(welcome.prayUrl))
    expect(r.text).toContain('Thank you for joining us!')
    expect(r.text).toContain('Read the guide before day one.')
  })

  it('puts the reminder note after the main text', () => {
    const r = reminderEmail(ctx, 'en', { ...reminder, emailText: text })
    expect(r.html.indexOf('Pray for the families of the city.')).toBeGreaterThan(r.html.indexOf('</h1>'))
    expect(r.html.indexOf('Pray for the families of the city.')).toBeLessThan(r.html.indexOf(reminder.prayUrl))
    expect(r.text).toContain('Pray for the families of the city.')
  })

  it('uses the email language', () => {
    const w = welcomeEmail(ctx, 'es', { ...welcome, emailText: text })
    expect(w.html).toContain('¡Gracias por unirte!')
    expect(w.html).toContain('Lee la guía antes del primer día.')
    expect(w.html).not.toContain('Thank you for joining us!')
    expect(w.html).not.toContain('Read the guide')
    const r = reminderEmail(ctx, 'es', { ...reminder, emailText: text })
    expect(r.html).toContain('Ora por las familias de la ciudad.')
    expect(r.text).toContain('Ora por las familias de la ciudad.')
    expect(r.html).not.toContain('Pray for the families')
  })

  it("falls back to the site's default language", () => {
    const w = welcomeEmail(ctx, 'fr', { ...welcome, emailText: text })
    expect(w.html).toContain('Thank you for joining us!')
    expect(w.html).toContain('Read the guide before day one.')
    expect(reminderEmail(ctx, 'fr', { ...reminder, emailText: text }).text).toContain('Pray for the families of the city.')
  })

  it("falls back when the email language's text is empty", () => {
    const sparse: CampaignEmailText = {
      tagline: { source: 'en', values: { en: 'Thank you for joining us!', es: '  ' }, stale: [] },
      welcome: { en: doc('Read the guide before day one.'), es: { type: 'doc', content: [{ type: 'paragraph' }] } }
    }
    const w = welcomeEmail(ctx, 'es', { ...welcome, emailText: sparse })
    expect(w.html).toContain('Thank you for joining us!')
    expect(w.html).toContain('Read the guide before day one.')
  })

  it('adds nothing when the campaign has no text, or none in these languages', () => {
    const plainWelcome = welcomeEmail(ctx, 'en', welcome)
    const plainReminder = reminderEmail(ctx, 'en', reminder)
    for (const emailText of [{}, { tagline: { source: 'ar', values: { ar: 'شكرا' }, stale: [] }, welcome: { ar: doc('مرحبا') }, reminder: { ar: doc('صلّوا') } }] as CampaignEmailText[]) {
      expect(welcomeEmail(ctx, 'fr', { ...welcome, emailText }).html).toBe(welcomeEmail(ctx, 'fr', welcome).html)
      expect(welcomeEmail(ctx, 'en', { ...welcome, emailText })).toEqual(plainWelcome)
      expect(reminderEmail(ctx, 'en', { ...reminder, emailText })).toEqual(plainReminder)
    }
  })

  it('escapes what the champion wrote', () => {
    const hostile: CampaignEmailText = {
      tagline: { source: 'en', values: { en: '<script>alert(1)</script> & <b>bold</b>' }, stale: [] },
      welcome: { en: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '<img src=x onerror=alert(1)>', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] } },
      reminder: { en: doc('<iframe src="https://evil.example"></iframe>') }
    }
    const w = welcomeEmail(ctx, 'en', { ...welcome, emailText: hostile })
    expect(w.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;bold&lt;/b&gt;')
    expect(w.html).not.toContain('<script>')
    expect(w.html).not.toContain('<b>bold')
    expect(w.html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(w.html).not.toContain('<img src=x')
    expect(w.html).not.toContain('javascript:')
    const r = reminderEmail(ctx, 'en', { ...reminder, emailText: hostile })
    expect(r.html).toContain('&lt;iframe src=&quot;https://evil.example&quot;&gt;&lt;/iframe&gt;')
    expect(r.html).not.toContain('<iframe')
  })
})
