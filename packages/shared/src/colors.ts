// Brand color handling: text on a brand color is white or dark, whichever
// contrasts better, and a color too pale for white text and too light to
// read as a link on white gets a warning.
export function parseHex(color: string): [number, number, number] | null {
  const m = color.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  let hex = m[1]!
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('')
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
}

function channel(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function luminance(rgb: [number, number, number]): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
}

export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const WHITE: [number, number, number] = [255, 255, 255]
const DARK: [number, number, number] = [24, 24, 27]

export interface BrandColorInfo {
  color: string
  textColor: '#ffffff' | '#18181b' | '#000000'
  // True when the color is too pale to be readable on a white page.
  tooPale: boolean
}

export const DEFAULT_BRAND_COLOR = '#2f6f5e'

export const BRAND_COLOR_PRESETS = [DEFAULT_BRAND_COLOR, '#1d4ed8', '#0f766e', '#15803d', '#b45309', '#b91c1c', '#7e22ce', '#be185d', '#334155']

// A new site starts on a random preset so sites don't all look alike.
export function randomBrandColor(): string {
  return BRAND_COLOR_PRESETS[Math.floor(Math.random() * BRAND_COLOR_PRESETS.length)]!
}

export function brandColor(color: string | null | undefined): BrandColorInfo {
  const rgb = parseHex(color ?? '') ?? parseHex(DEFAULT_BRAND_COLOR)!
  const hex = `#${rgb.map(c => c.toString(16).padStart(2, '0')).join('')}`
  const onWhite = contrastRatio(rgb, WHITE)
  const textColor = onWhite >= 4.5 && onWhite >= contrastRatio(rgb, DARK) ? '#ffffff' : contrastRatio(rgb, DARK) >= 4.5 ? '#18181b' : '#000000'
  return { color: hex, textColor, tooPale: onWhite < 3 }
}

export function brandForeground(color: string): string {
  let rgb = parseHex(color) ?? parseHex(DEFAULT_BRAND_COLOR)!
  while (contrastRatio(rgb, WHITE) < 4.5) {
    rgb = rgb.map(c => Math.max(0, Math.floor(c * 0.95))) as [number, number, number]
  }
  return `#${rgb.map(c => c.toString(16).padStart(2, '0')).join('')}`
}
