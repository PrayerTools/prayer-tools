import { describe, expect, it } from 'vitest'
import { expandHiddenCustom, isHideableSection, isSectionHidden, landingOrder, storedLandingOrder, visibleSections } from '../src/landing'

const all = { hasStories: true, hasWhy: true, appAvailable: true, hasCustom: () => true }
const custom = [{ id: 'a' }, { id: 'b' }]

describe('landing section order', () => {
  it('puts custom sections after "why" by default, in their own order', () => {
    expect(landingOrder(undefined, [])).toEqual(['goal', 'why', 'stories', 'how', 'signup', 'today', 'share', 'contact', 'app'])
    expect(landingOrder(undefined, ['a', 'b'])).toEqual(['goal', 'why', 'custom:a', 'custom:b', 'stories', 'how', 'signup', 'today', 'share', 'contact', 'app'])
  })

  it('follows a stored order', () => {
    const stored = ['goal', 'signup', 'custom:b', 'why', 'stories', 'custom:a', 'how', 'today', 'share', 'contact', 'app']
    expect(landingOrder(stored, ['a', 'b'])).toEqual(stored)
  })

  it('slots sections missing from the stored order in after the sections that precede them by default', () => {
    // A custom section added after the order was stored.
    expect(landingOrder(['why', 'stories', 'custom:a', 'how', 'signup', 'today', 'share', 'contact', 'app'], ['a', 'b']))
      .toEqual(['goal', 'why', 'stories', 'custom:a', 'custom:b', 'how', 'signup', 'today', 'share', 'contact', 'app'])
    expect(landingOrder(['stories', 'custom:a', 'why', 'how', 'signup', 'today', 'share', 'contact', 'app'], ['a', 'b']))
      .toEqual(['goal', 'stories', 'custom:a', 'why', 'custom:b', 'how', 'signup', 'today', 'share', 'contact', 'app'])
    expect(landingOrder(['signup', 'why', 'stories', 'how', 'today', 'share', 'contact', 'app'], ['a']))
      .toEqual(['goal', 'signup', 'why', 'custom:a', 'stories', 'how', 'today', 'share', 'contact', 'app'])
    // Standard sections the stored order does not know.
    expect(landingOrder(['signup', 'how', 'stories'], []))
      .toEqual(['goal', 'why', 'signup', 'how', 'stories', 'today', 'share', 'contact', 'app'])
  })

  it('drops unknown entries, deleted custom sections, the top section and duplicates', () => {
    expect(landingOrder(['top', 'signup', 'nope', 'custom', 'custom:gone', 'custom:a', 'signup', 'why', 'custom:a', 'stories', 'how', 'today', 'share', 'contact', 'app'], ['a']))
      .toEqual(['goal', 'signup', 'custom:a', 'why', 'stories', 'how', 'today', 'share', 'contact', 'app'])
    expect(landingOrder('why' as unknown as string[], ['a'])).toEqual(landingOrder(undefined, ['a']))
  })

  it('stores no order while it matches the default', () => {
    expect(storedLandingOrder(undefined, ['a'])).toBeUndefined()
    expect(storedLandingOrder(landingOrder(undefined, ['a']), ['a'])).toBeUndefined()
    expect(storedLandingOrder(['why', 'nope'], ['a'])).toBeUndefined()
    expect(storedLandingOrder(['custom:a', 'why'], ['a'])).toEqual(['goal', 'custom:a', 'why', 'stories', 'how', 'signup', 'today', 'share', 'contact', 'app'])
  })
})

describe('landing section visibility', () => {
  it('shows every section with something to show, in order', () => {
    expect(visibleSections({ custom }, 'generic', all)).toEqual(['goal', 'why', 'custom:a', 'custom:b', 'stories', 'how', 'signup', 'today', 'share', 'contact', 'app'])
    expect(visibleSections({ custom, order: ['signup', 'custom:b', 'why'] }, 'generic', { hasStories: false, hasWhy: false, appAvailable: false, hasCustom: id => id === 'b' }))
      .toEqual(['goal', 'signup', 'custom:b', 'how', 'today', 'share', 'contact'])
  })

  it('hides one custom section by its own entry', () => {
    expect(visibleSections({ custom, hidden: ['custom:a', 'how'] }, 'generic', all)).toEqual(['goal', 'why', 'custom:b', 'stories', 'signup', 'today', 'share', 'contact', 'app'])
  })

  it('hides every custom section when "custom" is hidden', () => {
    expect(visibleSections({ custom, hidden: ['custom'] }, 'generic', all)).toEqual(['goal', 'why', 'stories', 'how', 'signup', 'today', 'share', 'contact', 'app'])
    expect(isSectionHidden(['custom'], 'custom:a')).toBe(true)
    expect(isSectionHidden(['custom:b'], 'custom:a')).toBe(false)
  })

  it('always shows the signup form', () => {
    expect(visibleSections({ hidden: ['signup', 'why'] }, 'generic', all)).toContain('signup')
  })

  it('uses the template\'s hidden sections until the site stores its own', () => {
    expect(visibleSections({}, 'disaster_4', all)).not.toContain('stories')
    expect(visibleSections({ hidden: [] }, 'disaster_4', all)).toContain('stories')
  })

  it('expands "custom" into one entry per custom section', () => {
    expect(expandHiddenCustom(['how', 'custom'], ['a', 'b'])).toEqual(['how', 'custom:a', 'custom:b'])
    expect(expandHiddenCustom(['custom', 'custom:a'], ['a', 'b'])).toEqual(['custom:a', 'custom:b'])
    expect(expandHiddenCustom(['how', 'custom:a'], ['a', 'b'])).toEqual(['how', 'custom:a'])
  })

  it('lets a champion hide standard sections and existing custom sections only', () => {
    expect(isHideableSection('why', [])).toBe(true)
    expect(isHideableSection('custom', [])).toBe(true)
    expect(isHideableSection('custom:a', ['a'])).toBe(true)
    expect(isHideableSection('custom:a', [])).toBe(false)
    expect(isHideableSection('signup', [])).toBe(false)
    expect(isHideableSection('top', [])).toBe(false)
  })
})
