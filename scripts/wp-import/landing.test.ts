import { describe, expect, test } from 'bun:test'
import { tiptapToText } from '@prayertools/shared/tiptap'
import { landingText, type LandingInput } from './landing'
import type { Meta } from './wp'

const input = (ramadan: boolean): LandingInput => ({
  defaultLanguage: 'en',
  languages: ['en', 'fr'],
  ramadan,
  campaignName: 'Pray for Yemen',
  rewrite: async doc => doc,
  rewriteUrl: async url => url,
  defaultIcon: async column => `https://files.example/${column}.webp`
})
const meta = (fields: Record<string, string>): Meta => new Map(Object.entries(fields).map(([k, v]) => [k, [v]]))
const landing = async (fields: Record<string, string>, ramadan = true) => await landingText(meta(fields), undefined, input(ramadan))

describe('why we pray', () => {
  test('an unchanged vision, or one saved as the plugin\'s default, is not imported', async () => {
    expect((await landing({})).landing.why).toBeUndefined()
    expect((await landing({ vision: 'We want to cover this region with continuous 24/7 prayer.' }, false)).landing.why).toBeUndefined()
  })

  test('a changed vision alone is imported without the columns, in each language', async () => {
    const why = (await landing({ vision: 'To cover Yemen with continuous 24/7 prayer.' })).landing.why!
    expect(why.en.content!.map(n => n.type)).toEqual(['paragraph'])
    expect(tiptapToText(why.fr)).toBe('To cover Yemen with continuous 24/7 prayer.')
  })

  test('a changed column brings all three columns side by side, the unchanged ones as WordPress showed them', async () => {
    const why = (await landing({ time_section_text: 'Pray an hour each week.' })).landing.why!
    expect(why.en.content!.map(n => n.type)).toEqual(['paragraph', 'columns'])
    expect(why.en.content![1]!.content!.map(n => n.type)).toEqual(['column', 'column', 'column'])
    expect(tiptapToText(why.en)).toMatch(/^We want to cover this region with continuous 24\/7 prayer\.\s+Extraordinary Prayer\s+Every disciple making movement.*Pray an hour each week\.$/s)
    expect(tiptapToText(why.fr)).toMatch(/Prière extraordinaire/)
  })

  test('each column starts with its icon: the champion\'s own, else the plugin\'s', async () => {
    const why = (await landing({ vision: 'To cover Yemen with prayer.', movement_section_icon: 'https://cdn.example/arrows.png' })).landing.why!
    const firsts = why.en.content![1]!.content!.map(col => col.content![0])
    expect(firsts.map(n => n!.attrs?.src)).toEqual(['https://files.example/pray.webp', 'https://cdn.example/arrows.png', 'https://files.example/time.webp'])
    expect(firsts[0]).toEqual({ type: 'imageResize', attrs: { src: 'https://files.example/pray.webp', alt: '', width: 40 } })
  })

  test('a champion\'s own icon alone counts as a change', async () => {
    expect((await landing({ pray_section_icon: 'https://cdn.example/hands.png' })).landing.why).toBeDefined()
  })

  test('a changed column brings the vision with it, and a daily-prayer campaign shows "with prayer" and "Together"', async () => {
    const why = (await landing({ campaign_goal: 'quantity', pray_section_text: 'Prayer comes first.' })).landing.why!
    expect(tiptapToText(why.en)).toMatch(/^We want to cover this region with prayer\..*Prayer comes first\..*Together/s)
  })

  test('the video goes at the end, and is kept on its own when the vision is unchanged', async () => {
    const url = 'https://www.youtube.com/watch?v=abc123def45'
    const why = (await landing({ vision: 'To cover Yemen with prayer.', promo_video_url: url })).landing.why!
    expect(why.en.content!.at(-1)).toEqual({ type: 'youtube', attrs: { src: url } })
    expect(why.fr.content!.at(-1)?.type).toBe('youtube')
    expect((await landing({ promo_video_url: url })).landing.why!.en.content).toEqual([{ type: 'youtube', attrs: { src: url } }])
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

  test('line breaks stay line breaks, and a blank line starts a new paragraph', async () => {
    const about = (await landing({ what_content: 'Ten countries to pray for:\r\n\r\n•Iran-85 UPGs\r\n•Russia-119 UPGs\r\n\r\nOne email per day.' }, false)).landing.about!
    expect(about.en.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Ten countries to pray for:' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '•Iran-85 UPGs' }, { type: 'hardBreak' }, { type: 'text', text: '•Russia-119 UPGs' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'One email per day.' }] }
    ])
  })

  test('newlines between HTML blocks add no empty lines', async () => {
    const about = (await landing({ what_content: '<p><b>Who are the Azerbaijanis?</b></p>\n\nAzerbaijanis are a Muslim-background people.\n<p><a href="https://example.org/">Read more</a></p>\n' }, false)).landing.about!
    expect(about.en.content!.map(n => n.type)).toEqual(['paragraph', 'paragraph', 'paragraph'])
    expect(about.en.content!.flatMap(n => n.content ?? []).some(n => n.type === 'hardBreak')).toBe(false)
  })
})

describe('email identity', () => {
  test('the signature keeps its lines', async () => {
    const t = await landing({ email_signature: 'You are loved!\r\n\r\nAscend Prayer Team' })
    expect(t.emailIdentity.signature?.values.en).toBe('You are loved!\n\nAscend Prayer Team')
  })
})
