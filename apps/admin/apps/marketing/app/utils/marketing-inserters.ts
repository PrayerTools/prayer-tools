// Client registries the host fills from a Nuxt app plugin, both empty by default:
// - `registerMarketingExtensions`: Tiptap extensions for nodes the host renders
//   in email that the email editor lacks, so docs holding them open and keep them.
// - `registerMarketingInserter`: content the host can insert, such as images or
//   saved blocks from its own library. Each inserter is a toolbar button that
//   either opens the host's picker or lists items in a menu, and hands back
//   Tiptap content to insert at the cursor.
import type { Component } from 'vue'
import type { Extensions, JSONContent } from '@tiptap/vue-3'

export interface MarketingInsert {
  content: JSONContent[]
  /** A short note shown after inserting, e.g. what will look different in the email. */
  note?: string
}

export interface MarketingInsertItem {
  id: string
  label: string
  insert: () => MarketingInsert
}

interface MarketingInserterBase {
  /** Stable id; a repeat registration with the same id replaces it. */
  id: string
  label: string
  icon: string
  /** Ascending toolbar order (default 100). */
  order?: number
}

export type MarketingInserter = MarketingInserterBase & (
  /**
   * A modal picker taking `open` (v-model) and `language` (the email
   * version's language) props and emitting `select`; `toInsert` turns the
   * picked value into content.
   */
  | { picker: { component: Component, toInsert: (picked: never) => MarketingInsert }, items?: never }
  /** A menu of items, loaded when an editable editor opens. */
  | { items: () => Promise<MarketingInsertItem[]>, picker?: never }
)

const _inserters: MarketingInserter[] = []

export function registerMarketingInserter(inserter: MarketingInserter): void {
  const i = _inserters.findIndex(x => x.id === inserter.id)
  if (i >= 0) _inserters[i] = inserter
  else _inserters.push(inserter)
}

export function getMarketingInserters(): MarketingInserter[] {
  return [..._inserters].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
}

const _extensions = new Map<string, Extensions>()

/** A repeat registration with the same id replaces it. */
export function registerMarketingExtensions(id: string, extensions: Extensions): void {
  _extensions.set(id, extensions)
}

export function getMarketingExtensions(): Extensions {
  return [..._extensions.values()].flat().filter((e, i, all) => all.findIndex(x => x.name === e.name) === i)
}

export type MarketingNodeKind = 'textblock' | 'block' | 'inline'

// Fits content to the editor's schema: a node of an unknown type is replaced
// by its children, inline runs where blocks belong are wrapped in paragraphs,
// and unknown marks, unknown leaf nodes and blocks inside text are left out.
// `changed` says whether anything was unwrapped or left out.
export function marketingFitContent(
  nodes: JSONContent[],
  kindOf: (type: string) => MarketingNodeKind | undefined,
  hasMark: (type: string) => boolean
): { content: JSONContent[], changed: boolean } {
  let changed = false
  const fit = (list: JSONContent[], inline: boolean): JSONContent[] => {
    const out: JSONContent[] = []
    for (const n of list) {
      const kind = n.type ? kindOf(n.type) : undefined
      if (!kind) {
        changed = true
        out.push(...fit(n.content ?? [], inline))
        continue
      }
      if (inline && kind !== 'inline') {
        changed = true
        continue
      }
      const marks = n.marks?.filter(m => hasMark(m.type))
      if (marks && marks.length !== n.marks!.length) changed = true
      const content = n.content ? fit(n.content, kind === 'textblock') : undefined
      out.push({ ...n, ...(marks ? { marks } : {}), ...(content ? { content } : {}) })
    }
    return inline ? out : wrapInline(out)
  }
  const wrapInline = (list: JSONContent[]): JSONContent[] => {
    const out: JSONContent[] = []
    let run: JSONContent[] = []
    const flush = () => {
      if (run.length) out.push({ type: 'paragraph', content: run })
      run = []
    }
    for (const n of list) {
      if (kindOf(n.type!) === 'inline') run.push(n)
      else {
        flush()
        out.push(n)
      }
    }
    flush()
    return out
  }
  return { content: fit(nodes, false), changed }
}
