// Audio block for the editor: an uploaded or linked audio file with an
// optional title, stored as an `audio` node ({ src, title }) and played by the
// browser's own player.
import { Node, mergeAttributes } from '@tiptap/core'

export const PtAudio = Node.create({
  name: 'audio',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null, parseHTML: el => el.getAttribute('data-src'), renderHTML: a => (a.src ? { 'data-src': a.src } : {}) },
      title: { default: null, parseHTML: el => el.getAttribute('data-title'), renderHTML: a => (a.title ? { 'data-title': a.title } : {}) }
    }
  },
  parseHTML() {
    return [{ tag: 'figure[data-type="audio"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const title = String(node.attrs.title ?? '')
    return ['figure', mergeAttributes({ 'data-type': 'audio', 'class': 'pt-audio' }, HTMLAttributes),
      ['figcaption', {}, title || 'Audio'],
      ['audio', { src: node.attrs.src ?? '', controls: 'true', preload: 'none' }]
    ]
  }
})
