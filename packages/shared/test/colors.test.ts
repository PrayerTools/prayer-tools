import { describe, expect, it } from 'vitest'
import { BRAND_COLOR_PRESETS, brandColor, randomBrandColor, brandForeground, parseHex, contrastRatio } from '../src/colors'

describe('theme contrast', () => {
  it('keeps text readable on theme backgrounds and white pages across the color range', () => {
    for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) {
      const color = `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')}`
      expect(contrastRatio(parseHex(color)!, parseHex(brandColor(color).textColor)!)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(parseHex(brandForeground(color))!, [255, 255, 255])).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('randomBrandColor', () => {
  it('picks one of the presets', () => {
    for (let i = 0; i < 50; i++) expect(BRAND_COLOR_PRESETS).toContain(randomBrandColor())
  })

  it('only offers presets readable on a white page', () => {
    for (const c of BRAND_COLOR_PRESETS) expect(brandColor(c).tooPale).toBe(false)
  })
})
