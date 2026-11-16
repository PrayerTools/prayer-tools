// Button for the site email editor: a labelled link stored as a `button` node
// ({ href, label }), which the shared renderer sends as an email-safe button.
import { Node } from '@tiptap/core'

export const PtButton = Node.create({
  name: 'button',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      href: { default: null, renderHTML: () => ({}) },
      label: { default: '', renderHTML: () => ({}) }
    }
  },
  parseHTML() {
    return [{
      tag: 'p[data-type="button"]',
      priority: 60,
      getAttrs: el => ({ href: el.getAttribute('data-href'), label: el.textContent?.trim() ?? '' })
    }]
  },
  renderHTML({ node }) {
    return ['p', { 'data-type': 'button', 'data-href': node.attrs.href ?? '', 'style': 'text-align:center;' }, ['span', {
      title: node.attrs.href ?? '',
      style: 'display:inline-block;padding:0.5rem 1.25rem;border-radius:0.5rem;background:var(--ui-primary);color:var(--ui-bg);font-weight:600;text-decoration:none;'
    }, String(node.attrs.label ?? '')]]
  }
})
