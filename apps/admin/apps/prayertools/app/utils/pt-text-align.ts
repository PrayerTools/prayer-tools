// Keeps a paragraph's or heading's `textAlign` attribute (left, center, right,
// justify), which the shared renderer applies, in editors without alignment buttons.
import { Extension } from '@tiptap/core'

const ALIGNS = ['left', 'center', 'right', 'justify']

export const PtTextAlign = Extension.create({
  name: 'ptTextAlign',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        textAlign: {
          default: null,
          parseHTML: el => (ALIGNS.includes(el.style.textAlign) ? el.style.textAlign : null),
          renderHTML: a => (ALIGNS.includes(a.textAlign) ? { style: `text-align:${a.textAlign}` } : {})
        }
      }
    }]
  }
})
