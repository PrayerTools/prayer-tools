// A link on an image (`href`), which the shared renderer wraps the image in.
// Pasted HTML keeps the link of an `<a>` around an image.
import { Extension } from '@tiptap/core'

export const PtImageLink = Extension.create({
  name: 'ptImageLink',
  addGlobalAttributes() {
    return [{
      types: ['image'],
      attributes: {
        href: {
          default: null,
          parseHTML: el => el.getAttribute('data-href') ?? el.closest('a')?.getAttribute('href') ?? null,
          renderHTML: a => (a.href ? { 'data-href': a.href } : {})
        }
      }
    }]
  }
})
