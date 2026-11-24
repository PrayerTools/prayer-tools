import { describe, expect, it } from 'vitest'
import { isTemplateDoc, landingDoc, templateDoc } from '../src/i18n/landing'
import { visionDoc } from '../src/i18n/vision'
import { textDoc, tiptapToText } from '../src/tiptap'

const own = textDoc('Our own words.')

describe('landing template texts', () => {
  it('gives the Ramadan template the plugin\'s vision as "why" and its text about Ramadan as "about"', () => {
    expect(tiptapToText(templateDoc('why', 'ramadan', 'en'))).toMatch(/^We want to cover this region with continuous 24\/7 prayer\.\s+Extraordinary Prayer/)
    expect(tiptapToText(templateDoc('about', 'ramadan', 'en'))).toMatch(/^Ramadan is one of the five requirements/)
    expect(tiptapToText(templateDoc('why', 'ramadan', 'fr'))).toMatch(/^Nous voulons couvrir cette région/)
  })

  it('uses the template text when the site has none of its own', () => {
    expect(landingDoc('about', {}, 'ramadan', 'fr', 'en')).toEqual(templateDoc('about', 'ramadan', 'fr'))
    expect(landingDoc('why', { en: textDoc('') }, 'ramadan', 'en', 'en')).toEqual(templateDoc('why', 'ramadan', 'en'))
  })

  it('falls back to the default language, and has nothing for templates without text', () => {
    expect(templateDoc('about', 'ramadan', 'xx', 'es')).toEqual(templateDoc('about', 'ramadan', 'es'))
    expect(templateDoc('why', 'ramadan', 'xx', 'es')).toEqual(templateDoc('why', 'ramadan', 'es'))
    expect(landingDoc('why', {}, 'generic', 'en', 'en')).toBeNull()
    expect(landingDoc('about', {}, 'generic', 'en', 'en')).toBeNull()
  })

  it('prefers the site\'s own text in the language or the default language', () => {
    expect(landingDoc('about', { fr: own }, 'ramadan', 'fr', 'en')).toBe(own)
    expect(landingDoc('about', { en: own }, 'ramadan', 'fr', 'en')).toBe(own)
    expect(landingDoc('about', { fr: own }, 'ramadan', 'en', 'en')).toEqual(templateDoc('about', 'ramadan', 'en'))
  })

  it('gives every template the text about praying together', () => {
    expect(tiptapToText(templateDoc('together', 'generic', 'en'))).toMatch(/^When we pray together/)
    expect(templateDoc('together', null, 'fr')).toEqual(templateDoc('together', 'ramadan', 'fr'))
    expect(templateDoc('together', 'generic', 'xx')).toBeNull()
  })

  it('recognises the unchanged template text only in its own language', () => {
    expect(isTemplateDoc('about', templateDoc('about', 'ramadan', 'ar'), 'ramadan', 'ar')).toBe(true)
    expect(isTemplateDoc('why', templateDoc('why', 'ramadan', 'ar'), 'ramadan', 'ar')).toBe(true)
    expect(isTemplateDoc('about', templateDoc('about', 'ramadan', 'en'), 'ramadan', 'fr')).toBe(false)
    expect(isTemplateDoc('why', visionDoc('en', true), 'ramadan', 'en')).toBe(false)
    expect(isTemplateDoc('about', own, 'ramadan', 'en')).toBe(false)
  })
})
