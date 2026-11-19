import { describe, expect, test } from 'bun:test'
import { isLegacyPath, legacyTarget } from '../server/utils/legacy-paths'

const site = { languages: ['en', 'fr', 'ar'], defaultLanguage: 'en', campaignSlugs: ['ramadan2025', 'ramadan2026'] }
const target = (path: string) => {
  const url = new URL(path, 'http://x')
  return legacyTarget(url.pathname.split('/').filter(Boolean), url.searchParams, site)
}
const to = (path: string) => {
  const t = target(path)
  return t?.kind === 'redirect' ? t.to : t
}

describe('legacyTarget', () => {
  test('the day list and the fuel editing list open the pray page', () => {
    expect(to('/ramadan2026/list')).toBe('/ramadan2026/pray')
    expect(to('/list')).toBe('/pray')
    expect(to('/ramadan2026/listEdit')).toBe('/ramadan2026/pray')
  })

  test('contact-us opens the contact page', () => {
    expect(to('/ramadan2026/contact-us')).toBe('/ramadan2026/contact')
    expect(to('/contact-us')).toBe('/contact')
  })

  test('fuel days keep their number', () => {
    expect(to('/ramadan2025/fuel/7')).toBe('/ramadan2025/pray/7')
    expect(to('/ramadan2025/fuel')).toBe('/ramadan2025/pray')
  })

  test('?lang with a WordPress locale becomes the language prefix', () => {
    expect(to('/ramadan2026/fuel/3?lang=fr_FR')).toBe('/fr/ramadan2026/pray/3')
    expect(to('/ramadan2026/list?lang=ar_EG')).toBe('/ar/ramadan2026/pray')
    expect(to('/ramadan2026?lang=fr_FR')).toBe('/fr/ramadan2026')
    expect(to('/?lang=fr_FR&utm_source=x')).toBe('/fr?utm_source=x')
  })

  test('the default language, an unknown language or an existing prefix change nothing', () => {
    expect(to('/ramadan2026?lang=en_US')).toBeNull()
    expect(to('/ramadan2026?lang=de_DE')).toBeNull()
    expect(to('/fr/ramadan2026?lang=ar')).toBeNull()
  })

  test('a personal fuel key is looked up on the pray page of its campaign and language', () => {
    expect(target('/prayer/fuel/abc123?lang=fr_FR')).toEqual({ kind: 'fuel_key', key: 'abc123', base: '/fr/pray' })
    expect(target('/ramadan2026/prayer/fuel/abc123')).toEqual({ kind: 'fuel_key', key: 'abc123', base: '/ramadan2026/pray' })
  })

  test('page names after other segments are left alone', () => {
    expect(to('/stories/list')).toBeNull()
  })
})

describe('isLegacyPath', () => {
  test('ignores the API', () => {
    expect(isLegacyPath(['api', 'view'], new URLSearchParams('lang=fr'))).toBe(false)
    expect(isLegacyPath(['ramadan2026', 'list'], new URLSearchParams())).toBe(true)
  })
})
