// Columns for the editor: a `columns` node holding 2 or 3 `column` nodes side
// by side, with each column's share of the row in `widths` (e.g. [33, 67]; no
// widths means equal shares). The helpers change the columns around the
// selection inside a command chain.
import { Node, mergeAttributes } from '@tiptap/core'
import { Fragment, type Node as PmNode } from '@tiptap/pm/model'
import { NodeSelection, TextSelection, type Transaction } from '@tiptap/pm/state'
import { columnWidths } from '@prayertools/shared/tiptap'

export const PtColumn = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,
  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'column', 'class': 'pt-column' }, HTMLAttributes), 0]
  }
})

export const PtColumns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column{2,3}',
  isolating: true,
  defining: true,
  addAttributes() {
    return {
      widths: {
        default: null,
        parseHTML: (el) => {
          try {
            const w = JSON.parse(el.getAttribute('data-widths') ?? 'null')
            return Array.isArray(w) ? w : null
          } catch {
            return null
          }
        },
        renderHTML: a => (Array.isArray(a.widths) ? { 'data-widths': JSON.stringify(a.widths) } : {})
      }
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="columns"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const widths = columnWidths(node.attrs.widths, node.childCount)
    return ['div', mergeAttributes({ 'data-type': 'columns', 'class': 'pt-columns', 'style': `grid-template-columns:${widths.map(w => `${w}fr`).join(' ')}` }, HTMLAttributes), 0]
  }
})

export interface ColumnLayout {
  label: string
  icon: string
  widths: number[]
}

export const COLUMN_LAYOUTS: ColumnLayout[] = [
  { label: 'Two equal columns', icon: 'i-lucide-columns-2', widths: [50, 50] },
  { label: 'Narrow, then wide', icon: 'i-lucide-panel-left', widths: [33, 67] },
  { label: 'Wide, then narrow', icon: 'i-lucide-panel-right', widths: [67, 33] },
  { label: 'Three equal columns', icon: 'i-lucide-columns-3', widths: [33, 33, 33] }
]

// The innermost columns node holding the selection, or the selected one.
export function columnsAt(tr: Pick<Transaction, 'selection'>): { node: PmNode, pos: number } | null {
  const { selection } = tr
  if (selection instanceof NodeSelection && selection.node.type.name === 'columns') return { node: selection.node, pos: selection.from }
  const { $from } = selection
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'columns') return { node: $from.node(d), pos: $from.before(d) }
  }
  return null
}

function equal(widths: number[]): boolean {
  return widths.every(w => w === widths[0])
}

export function isColumnLayout(node: PmNode, layout: ColumnLayout): boolean {
  if (node.childCount !== layout.widths.length) return false
  const current = columnWidths(node.attrs.widths, node.childCount)
  return equal(layout.widths) ? equal(current) : current.join() === layout.widths.join()
}

export function columnsContent(count: number) {
  return { type: 'columns', content: Array.from({ length: count }, () => ({ type: 'column', content: [{ type: 'paragraph' }] })) }
}

// Puts the cursor at the start of the first column around the selection.
export function selectFirstColumn(tr: Transaction): boolean {
  const found = columnsAt(tr)
  if (found) tr.setSelection(TextSelection.near(tr.doc.resolve(found.pos + 2)))
  return true
}

// Gives the columns around the selection `layout`'s count and widths. A
// column added starts empty; a column removed moves its content, if any, to
// the end of the one before it. Equal shares are stored as no widths.
export function setColumnLayout(tr: Transaction, layout: ColumnLayout): boolean {
  const found = columnsAt(tr)
  if (!found) return false
  const widths = equal(layout.widths) ? null : layout.widths
  const { schema } = tr.doc.type
  if (found.node.childCount === layout.widths.length) {
    tr.setNodeMarkup(found.pos, undefined, { ...found.node.attrs, widths })
    return true
  }
  const cols: PmNode[] = []
  found.node.forEach(c => cols.push(c))
  while (cols.length < layout.widths.length) cols.push(schema.nodes.column!.create(null, schema.nodes.paragraph!.create()))
  while (cols.length > layout.widths.length) {
    const last = cols.pop()!
    const prev = cols.pop()!
    const empty = last.childCount === 1 && last.firstChild!.isTextblock && last.firstChild!.content.size === 0
    cols.push(empty ? prev : prev.copy(prev.content.append(last.content)))
  }
  tr.replaceWith(found.pos, found.pos + found.node.nodeSize, schema.nodes.columns!.create({ ...found.node.attrs, widths }, cols))
  tr.setSelection(TextSelection.near(tr.doc.resolve(found.pos + 2)))
  return true
}

// Replaces the columns around the selection with their content, one column
// after the other.
export function removeColumns(tr: Transaction): boolean {
  const found = columnsAt(tr)
  if (!found) return false
  let content = Fragment.empty
  found.node.forEach((c) => {
    content = content.append(c.content)
  })
  tr.replaceWith(found.pos, found.pos + found.node.nodeSize, content)
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(found.pos + 1, tr.doc.content.size))))
  return true
}
