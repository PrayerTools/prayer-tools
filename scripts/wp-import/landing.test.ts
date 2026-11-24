import { describe, expect, test } from 'bun:test'
import { tiptapToText } from '@prayertools/shared/tiptap'
import { templateDoc } from '@prayertools/shared/i18n/landing'
import { landingText, type LandingInput } from './landing'
import type { Meta } from './wp'

const input = (ramadan: boolean): LandingInput => ({
  defaultLanguage: 'en',
  languages: ['en', 'fr'],
  ramadan,
  campaignName: 'Pray for Yemen',
  rewrite: async doc => doc,
  rewriteUrl: async url => url
})
const meta = (fields: Record<string, string>): Meta => new Map(Object.entries(fields).map(([k, v]) => [k, [v]]))
const landing = async (fields: Record<string, string>, ramadan = true) => await landingText(meta(fields), undefined, input(ramadan))

describe('why we pray', () => {
  test('an unchanged vision on the Ramadan template is left to the template\'s standard text', async () => {
    expect((await landing({})).landing.why).toBeUndefined()
  })

  test('the champion\'s vision keeps the default columns WordPress showed under it, in each language', async () => {
    const why = (await landing({ vision: 'To cover Yemen with continuous 24/7 prayer.' })).landing.why!
    expect(tiptapToText(why.en)).toMatch(/^To cover Yemen with continuous 24\/7 prayer\.\s+Extraordinary Prayer\s+Every disciple making movement/)
    expect(tiptapToText(why.fr)).toMatch(/^To cover Yemen with continuous 24\/7 prayer\.\s+Prière extraordinaire/)
  })

  test('a daily-prayer campaign showed the "with prayer" vision and "Together"', async () => {
    const why = (await landing({ campaign_goal: 'quantity' })).landing.why!
    expect(tiptapToText(why.en)).toMatch(/^We want to cover this region with prayer\..*Together/s)
  })

  test('other templates keep the default vision WordPress showed', async () => {
    const why = (await landing({}, false)).landing.why!
    expect(why.en).toEqual(templateDoc('why', 'ramadan', 'en')!)
  })

  test('the video goes at the end', async () => {
    const why = (await landing({ promo_video_url: 'https://www.youtube.com/watch?v=abc123def45' })).landing.why!
    expect(why.en.content!.at(-1)).toEqual({ type: 'youtube', attrs: { src: 'https://www.youtube.com/watch?v=abc123def45' } })
    expect(why.fr.content!.at(-1)?.type).toBe('youtube')
  })
})

describe('about', () => {
  test('the Ramadan template\'s default and lorem ipsum are not stored', async () => {
    expect((await landing({})).landing.about).toBeUndefined()
    expect((await landing({ what_content: '<p>Lorem ipsum dolor sit amet.</p>' }, false)).landing.about).toBeUndefined()
  })

  test('the champion\'s own text is kept', async () => {
    const about = (await landing({ what_content: '<p>Our own words about Ramadan.</p>' })).landing.about!
    expect(Object.keys(about)).toEqual(['en'])
    expect(tiptapToText(about.en)).toBe('Our own words about Ramadan.')
  })

  test('outside the Ramadan template the text\'s first heading becomes the section heading', async () => {
    const t = await landing({ what_content: '<h2>About Mali</h2><p>Mali is a country in West Africa.</p>' }, false)
    expect(tiptapToText(t.landing.about!.en)).toBe('Mali is a country in West Africa.')
    expect(t.siteStrings).toContainEqual({ key: 'landing.about.title', language: 'en', value: 'About Mali' })
  })
})
