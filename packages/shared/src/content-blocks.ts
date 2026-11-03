// Prayer content as a flat list of blocks, the shape AI clients read and write
// over MCP, converted to and from the Tiptap JSON the editor and renderer use.
// Inline text uses a small markup: **bold**, *italic*, ~~strike~~, `code`,
// [label](https://…), a newline for a line break, and a backslash to escape
// any of * ~ ` [ ] \. Placeholders such as {place} pass through unchanged.
import type { TiptapDoc, TiptapNode } from './db/schema'

export type BlockAlign = 'center' | 'right' | 'justify'

export type ContentBlock =
  | { type: 'paragraph', text: string, align?: BlockAlign }
  | { type: 'heading', level: number, text: string, align?: BlockAlign }
  | { type: 'list', ordered?: boolean, items: string[] }
  | { type: 'quote', text: string }
  | { type: 'verse', reference: string, translation?: string, text: string }
  | { type: 'image', src: string, alt: string, width?: number }
  | { type: 'video', url: string }
  | { type: 'button', label: string, url: string }
  | { type: 'divider' }

export const BLOCKS_FORMAT_HELP = [
  'Content is a list of blocks: paragraph {text, align?}, heading {level 1-6, text}, list {ordered?, items: string[]}, quote {text}, verse {reference, translation?, text}, image {src, alt, width?}, video {url: YouTube or Vimeo}, button {label, url}, divider.',
  'Text uses **bold**, *italic*, ~~strike~~, `code` and [label](https://…); a blank line starts a new paragraph, a single newline is a line break, and a backslash escapes * ~ ` [ ] \\.',
  'Put Scripture in verse blocks with its reference and translation, quoted exactly, never paraphrased.'
].join(' ')

export const CONTENT_BLOCKS_HELP = `${BLOCKS_FORMAT_HELP} Placeholders fill in per site: {site_name}, {campaign_name}, {place}, {in_place}, {of_place}, {people_group}, {start_date}, {end_date}.`

type Toggle = 'bold' | 'italic' | 'strike' | 'code'
type Mark = NonNullable<TiptapNode['marks']>[number]

const TOGGLES: Toggle[] = ['bold', 'italic', 'strike', 'code']
const ALIGNS: readonly string[] = ['center', 'right', 'justify']
const ESCAPABLE = /[\\*~`[\]]/g

function textNode(text: string, marks: Mark[]): TiptapNode {
  return marks.length ? { type: 'text', text, marks } : { type: 'text', text }
}

// Index of the next unescaped `marker` at or after `from`, or -1.
function findMarker(s: string, from: number, marker: string): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue }
    if (s.startsWith(marker, i)) return i
  }
  return -1
}

// `[label](href)` starting at `i`: the label ends at the matching `]`.
function matchLink(s: string, i: number): { label: string, href: string, end: number } | null {
  let depth = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue }
    if (s[j] === '[') depth++
    else if (s[j] === ']' && --depth === 0) {
      if (s[j + 1] !== '(') return null
      const close = s.indexOf(')', j + 2)
      if (close === -1) return null
      const href = s.slice(j + 2, close).trim()
      return href ? { label: s.slice(i + 1, j), href, end: close + 1 } : null
    }
  }
  return null
}

export function parseInline(s: string, base: Mark[] = []): TiptapNode[] {
  const out: TiptapNode[] = []
  const on = new Set<Toggle>()
  let buf = ''
  const marks = (): Mark[] => [...base, ...TOGGLES.filter(t => on.has(t)).map(type => ({ type }))]
  const flush = () => {
    if (buf) out.push(textNode(buf, marks()))
    buf = ''
  }
  const toggle = (t: Toggle) => {
    flush()
    if (on.has(t)) on.delete(t)
    else on.add(t)
  }
  let i = 0
  while (i < s.length) {
    const c = s[i]!
    if (on.has('code')) {
      if (c === '`') toggle('code')
      else buf += c
      i++
      continue
    }
    if (c === '\\' && i + 1 < s.length) {
      buf += s[i + 1]
      i += 2
      continue
    }
    if (c === '\n') {
      flush()
      out.push({ type: 'hardBreak' })
      i++
      continue
    }
    if (s.startsWith('**', i) && (on.has('bold') || findMarker(s, i + 2, '**') !== -1)) {
      toggle('bold')
      i += 2
      continue
    }
    if (s.startsWith('~~', i) && (on.has('strike') || findMarker(s, i + 2, '~~') !== -1)) {
      toggle('strike')
      i += 2
      continue
    }
    if (c === '*' && (on.has('italic') || findMarker(s, i + 1, '*') !== -1)) {
      toggle('italic')
      i++
      continue
    }
    if (c === '`' && s.indexOf('`', i + 1) !== -1) {
      toggle('code')
      i++
      continue
    }
    if (c === '[') {
      const link = matchLink(s, i)
      if (link) {
        flush()
        out.push(...parseInline(link.label, [...marks(), { type: 'link', attrs: { href: link.href } }]))
        i = link.end
        continue
      }
    }
    buf += c
    i++
  }
  flush()
  return out
}

function hasMark(n: TiptapNode, type: string): boolean {
  return !!n.marks?.some(m => m.type === type)
}

function linkOf(n: TiptapNode): string | null {
  const href = n.marks?.find(m => m.type === 'link')?.attrs?.href
  return typeof href === 'string' && href ? href : null
}

// Inline nodes back to markup. Toggles open and close on the transitions
// between text nodes; a link wraps its run of nodes, with toggles closed
// around it so the label starts and ends clean.
export function serializeInline(nodes: TiptapNode[] | undefined): string {
  const list = nodes ?? []
  let out = ''
  let on = new Set<Toggle>()
  const closeAll = () => {
    for (const t of [...TOGGLES].reverse()) if (on.has(t)) out += marker(t)
    on = new Set()
  }
  const run = (target: Set<Toggle>) => {
    for (const t of [...TOGGLES].reverse()) if (on.has(t) && !target.has(t)) out += marker(t)
    for (const t of TOGGLES) if (!on.has(t) && target.has(t)) out += marker(t)
    on = target
  }
  let i = 0
  while (i < list.length) {
    const n = list[i]!
    const href = n.type === 'text' ? linkOf(n) : null
    if (href) {
      closeAll()
      let j = i
      while (j < list.length && list[j]!.type === 'text' && linkOf(list[j]!) === href) j++
      out += `[${serializeInline(list.slice(i, j).map(stripLink))}](${href})`
      i = j
      continue
    }
    if (n.type === 'hardBreak') {
      out += '\n'
    } else if (n.type === 'text') {
      run(new Set(TOGGLES.filter(t => hasMark(n, t))))
      const text = n.text ?? ''
      out += on.has('code') ? text : text.replace(ESCAPABLE, m => `\\${m}`)
    } else {
      out += serializeInline(n.content)
    }
    i++
  }
  closeAll()
  return out
}

function marker(t: Toggle): string {
  return t === 'bold' ? '**' : t === 'italic' ? '*' : t === 'strike' ? '~~' : '`'
}

function stripLink(n: TiptapNode): TiptapNode {
  const marks = (n.marks ?? []).filter(m => m.type !== 'link')
  return marks.length ? { ...n, marks } : { type: n.type, text: n.text }
}

function paragraphs(text: string): TiptapNode[] {
  return text.split(/\n{2,}/).map(p => {
    const content = parseInline(p.replace(/^\n+|\n+$/g, ''))
    return content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
  })
}

function withAlign(node: TiptapNode, align: unknown): TiptapNode {
  if (typeof align === 'string' && ALIGNS.includes(align)) node.attrs = { ...node.attrs, textAlign: align }
  return node
}

export class ContentBlocksError extends Error {}

function need(cond: unknown, message: string): asserts cond {
  if (!cond) throw new ContentBlocksError(message)
}

export function blocksToDoc(blocks: ContentBlock[]): TiptapDoc {
  const content: TiptapNode[] = []
  blocks.forEach((b, i) => {
    const at = `blocks[${i}]`
    switch (b.type) {
      case 'paragraph':
        need(typeof b.text === 'string', `${at}: a paragraph needs text`)
        for (const p of paragraphs(b.text)) content.push(withAlign(p, b.align))
        break
      case 'heading': {
        need(typeof b.text === 'string' && b.text.trim(), `${at}: a heading needs text`)
        const level = Math.min(6, Math.max(1, Math.round(Number(b.level) || 2)))
        content.push(withAlign({ type: 'heading', attrs: { level }, content: parseInline(b.text.replace(/\n+/g, ' ')) }, b.align))
        break
      }
      case 'list':
        need(Array.isArray(b.items) && b.items.length, `${at}: a list needs items`)
        content.push({
          type: b.ordered ? 'orderedList' : 'bulletList',
          content: b.items.map(item => ({ type: 'listItem', content: paragraphs(String(item)) }))
        })
        break
      case 'quote':
        need(typeof b.text === 'string' && b.text.trim(), `${at}: a quote needs text`)
        content.push({ type: 'blockquote', content: paragraphs(b.text) })
        break
      case 'verse':
        need(typeof b.reference === 'string' && b.reference.trim(), `${at}: a verse needs its reference, e.g. "John 3:16"`)
        need(typeof b.text === 'string' && b.text.trim(), `${at}: a verse needs the verse text`)
        content.push({
          type: 'verse',
          attrs: { reference: b.reference.trim(), translation: b.translation?.trim() || null },
          content: paragraphs(b.text)
        })
        break
      case 'image':
        need(typeof b.src === 'string' && /^(https?:\/\/|\/)/.test(b.src), `${at}: an image needs an https src`)
        need(typeof b.alt === 'string' && b.alt.trim(), `${at}: describe the image in alt for people who can't see it`)
        content.push({ type: 'image', attrs: { src: b.src, alt: b.alt.trim(), ...(b.width ? { width: Math.round(b.width) } : {}) } })
        break
      case 'video':
        need(typeof b.url === 'string' && /^https?:\/\//.test(b.url), `${at}: a video needs a YouTube or Vimeo url`)
        content.push({ type: 'youtube', attrs: { src: b.url } })
        break
      case 'button':
        need(typeof b.label === 'string' && b.label.trim(), `${at}: a button needs a label`)
        need(typeof b.url === 'string' && /^(https?:\/\/|\/|mailto:)/.test(b.url), `${at}: a button needs a url`)
        content.push({ type: 'button', attrs: { href: b.url, label: b.label.trim() } })
        break
      case 'divider':
        content.push({ type: 'horizontalRule' })
        break
      default:
        throw new ContentBlocksError(`${at}: unknown block type "${(b as { type?: unknown }).type}"`)
    }
  })
  return { type: 'doc', content }
}

function align(n: TiptapNode): BlockAlign | undefined {
  const a = n.attrs?.textAlign
  return typeof a === 'string' && ALIGNS.includes(a) ? a as BlockAlign : undefined
}

function blockText(nodes: TiptapNode[] | undefined): string {
  return (nodes ?? []).map(n => n.type === 'paragraph' || n.type === 'heading' ? serializeInline(n.content) : blockText(n.content)).join('\n\n')
}

function toBlocks(nodes: TiptapNode[] | undefined): ContentBlock[] {
  const out: ContentBlock[] = []
  for (const n of nodes ?? []) {
    switch (n.type) {
      case 'paragraph':
        out.push({ type: 'paragraph', text: serializeInline(n.content), ...(align(n) ? { align: align(n) } : {}) })
        break
      case 'heading':
        out.push({ type: 'heading', level: Number(n.attrs?.level) || 2, text: serializeInline(n.content), ...(align(n) ? { align: align(n) } : {}) })
        break
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
        out.push({ type: 'list', ...(n.type === 'orderedList' ? { ordered: true } : {}), items: (n.content ?? []).map(li => blockText(li.content)) })
        break
      case 'blockquote':
        out.push({ type: 'quote', text: blockText(n.content) })
        break
      case 'verse': {
        const translation = n.attrs?.translation
        out.push({ type: 'verse', reference: String(n.attrs?.reference ?? ''), ...(typeof translation === 'string' && translation ? { translation } : {}), text: blockText(n.content) })
        break
      }
      case 'image':
      case 'imageResize': {
        const width = Number(n.attrs?.width)
        out.push({ type: 'image', src: String(n.attrs?.src ?? ''), alt: String(n.attrs?.alt ?? ''), ...(Number.isFinite(width) && width > 0 ? { width: Math.round(width) } : {}) })
        break
      }
      case 'youtube':
        out.push({ type: 'video', url: String(n.attrs?.src ?? '') })
        break
      case 'button':
        out.push({ type: 'button', label: String(n.attrs?.label ?? '') || serializeInline(n.content), url: String(n.attrs?.href ?? '') })
        break
      case 'horizontalRule':
        out.push({ type: 'divider' })
        break
      case 'codeBlock':
        out.push({ type: 'paragraph', text: serializeInline(n.content) })
        break
      default:
        out.push(...toBlocks(n.content))
    }
  }
  return out
}

// What the renderer reads from a doc, so docs that render alike compare equal.
const KEPT_ATTRS: Record<string, string[]> = {
  heading: ['level', 'textAlign'],
  paragraph: ['textAlign'],
  orderedList: ['start'],
  verse: ['reference', 'translation'],
  image: ['src', 'alt', 'width'],
  youtube: ['src'],
  button: ['href', 'label']
}

function normalize(nodes: TiptapNode[] | undefined): unknown[] {
  const out: Record<string, unknown>[] = []
  for (const n of nodes ?? []) {
    if (n.type === 'text') {
      if (!n.text) continue
      const marks = (n.marks ?? [])
        .map(m => m.type === 'link' ? `link:${String(m.attrs?.href ?? '')}` : m.type)
        .sort()
      const prev = out.at(-1)
      if (prev?.type === 'text' && JSON.stringify(prev.marks) === JSON.stringify(marks)) {
        prev.text = `${prev.text as string}${n.text}`
        continue
      }
      out.push({ type: 'text', text: n.text, marks })
      continue
    }
    const attrs: Record<string, unknown> = {}
    for (const k of KEPT_ATTRS[n.type] ?? []) {
      const v = n.attrs?.[k]
      if (v === null || v === undefined || v === '') continue
      if (k === 'textAlign' && !ALIGNS.includes(String(v))) continue
      if (k === 'level' || k === 'width' || k === 'start') attrs[k] = Number(v)
      else attrs[k] = v
    }
    if (n.type === 'orderedList' && attrs.start === 1) delete attrs.start
    out.push({ type: n.type, attrs, content: normalize(n.content) })
  }
  return out
}

// Blocks for a doc, and whether writing them back renders exactly the same.
// `exact` is false when the doc uses something blocks can't express (colors,
// nested lists, task checkboxes, resized images, …).
export function docToBlocks(doc: TiptapDoc | null | undefined): { blocks: ContentBlock[], exact: boolean } {
  const blocks = toBlocks(doc?.content)
  let exact = false
  try {
    exact = JSON.stringify(normalize(blocksToDoc(blocks).content)) === JSON.stringify(normalize(doc?.content))
  } catch {
    exact = false
  }
  return { blocks, exact }
}
