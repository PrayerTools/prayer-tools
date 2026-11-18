// Text color and highlight for prayer content. The stored color is kept as
// written (`textStyle.color`, `highlight.color`) and shown through a CSS
// variable (`--pt-color`, `--pt-mark`), so each theme can keep the hue while
// holding its lightness to what reads on that theme's background. The toolbar
// offers the swatches below; imported content may hold any valid color.
import { Color } from '@tiptap/extension-text-style'
import { Highlight } from '@tiptap/extension-highlight'
import { safeColor } from '@prayertools/shared/tiptap'

export interface PtSwatch {
  label: string
  value: string
}

export const PT_TEXT_COLORS: PtSwatch[] = [
  { label: 'Red', value: '#b91c1c' },
  { label: 'Orange', value: '#c2410c' },
  { label: 'Gold', value: '#a16207' },
  { label: 'Green', value: '#15803d' },
  { label: 'Teal', value: '#0f766e' },
  { label: 'Blue', value: '#1d4ed8' },
  { label: 'Purple', value: '#7e22ce' },
  { label: 'Gray', value: '#4b5563' }
]

export const PT_HIGHLIGHT_COLORS: PtSwatch[] = [
  { label: 'Yellow', value: '#fef08a' },
  { label: 'Orange', value: '#fed7aa' },
  { label: 'Red', value: '#fecaca' },
  { label: 'Pink', value: '#fbcfe8' },
  { label: 'Purple', value: '#e9d5ff' },
  { label: 'Blue', value: '#bfdbfe' },
  { label: 'Green', value: '#bbf7d0' },
  { label: 'Gray', value: '#e5e7eb' }
]

export const PtColor = Color.extend({
  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        color: {
          default: null,
          parseHTML: el => el.style.getPropertyValue('--pt-color').trim() || el.style.color || null,
          renderHTML: (a) => {
            const color = safeColor(a.color)
            return color ? { class: 'pt-color', style: `--pt-color: ${color}` } : {}
          }
        }
      }
    }]
  }
})

export const PtHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: el => el.getAttribute('data-color') || el.style.getPropertyValue('--pt-mark').trim() || el.style.backgroundColor || null,
        renderHTML: (a) => {
          const color = safeColor(a.color)
          return color ? { 'data-color': color, 'class': 'pt-mark', 'style': `--pt-mark: ${color}` } : {}
        }
      }
    }
  }
}).configure({ multicolor: true })
