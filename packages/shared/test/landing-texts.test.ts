import { describe, expect, it } from 'vitest'
import { isTemplateDoc, landingDoc, templateDoc } from '../src/i18n/landing'
import { textDoc, tiptapToText } from '../src/tiptap'

const own = textDoc('Our own words.')

describe('landing template texts', () => {
  it('gives the Ramadan template its text about Ramadan as "about", and no template a "why" text', () => {
    expect(tiptapToText(templateDoc('about', 'ramadan', 'en'))).toMatch(/^Ramadan is one of the five requirements/)
    expect(templateDoc('why', 'ramadan', 'en')).toBeNull()
    expect(templateDoc('why', 'generic', 'en')).toBeNull()
  })

  it('uses the template text when the site has none of its own', () => {
    expect(landingDoc('about', {}, 'ramadan', 'fr', 'en')).toEqual(templateDoc('about', 'ramadan', 'fr'))
    expect(landingDoc('why', { en: textDoc('') }, 'ramadan', 'en', 'en')).toBeNull()
  })

  it('falls back to the default language, and has nothing for templates without text', () => {
    expect(templateDoc('about', 'ramadan', 'xx', 'es')).toEqual(templateDoc('about', 'ramadan', 'es'))
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
    expect(isTemplateDoc('about', templateDoc('about', 'ramadan', 'en'), 'ramadan', 'fr')).toBe(false)
    expect(isTemplateDoc('about', own, 'ramadan', 'en')).toBe(false)
  })
})
