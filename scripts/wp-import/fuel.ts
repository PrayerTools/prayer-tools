// WordPress prayer fuel (Gutenberg block HTML) to a Tiptap document for the
// prayer.tools content editor. Emits only nodes and marks the editor registers
// (StarterKit, image with a link, verse, youtube, audio, columns, tables, text
// color, highlight, superscript, subscript): a mark or node it doesn't know
// makes the editor load the whole document empty. Quoted Bible passages
// become Scripture (`verse`) blocks. `unknown` names what was dropped or only
// approximated (a podcast embed kept as a link), once per kind.
import { parseDocument } from 'htmlparser2'
import { isComment, isTag, isText, type ChildNode, type Element } from 'domhandler'
import type { TiptapDoc, TiptapNode } from '@prayertools/shared/db/schema'
import { videoEmbed } from '@prayertools/shared/video'

type Mark = NonNullable<TiptapNode['marks']>[number]

export interface HtmlToDocOptions {
  // The content of a reusable block (`<!-- wp:block {"ref":N} /-->`): the
  // `post_content` of the same subsite's `wp_block` post N.
  reusableBlock?: (ref: number) => string | null | undefined
  // The words of the link that replaces an embedded Google map.
  mapLabel?: string
}

interface Ctx {
  unknown: Set<string>
  opts: HtmlToDocOptions
  refs: number[]
}

interface InlineMode {
  plain?: boolean
  pre?: boolean
}

export function htmlToDoc(html: string, opts: HtmlToDocOptions = {}): { doc: TiptapDoc, unknown: string[] } {
  const ctx: Ctx = { unknown: new Set(), opts, refs: [] }
  return { doc: { type: 'doc', content: scripture(blocks(parse(html), ctx)) }, unknown: [...ctx.unknown] }
}

function parse(html: string): ChildNode[] {
  return parseDocument(html, { decodeEntities: true }).children
}

// ── Placeholders ────────────────────────────────────────────────────────

// The campaigns plugin's location tokens (some translated or mistyped by
// translators), as prayer.tools placeholders.
export const TOKENS: Record<string, string> = {
  '[in location]': '{in_place}', '[of location]': '{of_place}', '[location]': '{place}', '[location_name]': '{place}',
  '[people_group]': '{people_group}', '[people_name]': '{people_group}',
  '[en el lugar]': '{in_place}', '[del lugar]': '{of_place}', '[am Ort]': '{in_place}', '[vor Ort]': '{in_place}',
  '[of locaion]': '{of_place}', '[location ]': '{place}', '[le lieu]': '{in_place}', '[Location]': '{place}',
  '[ in location]': '{in_place}', '[في المكان]': '{in_place}', '[المكان]': '{place}'
}
const TOKEN_RE = new RegExp(Object.keys(TOKENS).map(k => k.replace(/[[\]]/g, '\\$&')).join('|'), 'g')

function tokens(text: string): string {
  return text.includes('[') ? text.replace(TOKEN_RE, t => TOKENS[t]!) : text
}

// ── Blocks ──────────────────────────────────────────────────────────────

const CONTAINERS = new Set(['div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure', 'figcaption', 'center', 'dl', 'dt', 'dd', 'li', 'summary', 'tbody', 'thead', 'tfoot', 'hgroup', 'address'])
const BLOCK_TAGS = new Set([...CONTAINERS, 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote', 'hr', 'table', 'pre', 'details', 'audio', 'video', 'object', 'embed', 'form'])
const DROPPED = new Set(['script', 'style', 'noscript', 'template', 'form', 'input', 'button', 'select', 'textarea', 'svg', 'canvas', 'object', 'embed', 'map', 'link', 'meta', 'title'])
const SILENT = new Set(['style', 'link', 'meta', 'title'])

function classes(el: Element): string[] {
  return (el.attribs.class ?? '').trim().split(/\s+/).filter(Boolean)
}

function hasClass(el: Element, ...names: string[]): boolean {
  const c = classes(el)
  return names.some(n => c.includes(n))
}

function find(nodes: ChildNode[], test: (el: Element) => boolean): Element | null {
  for (const n of nodes) {
    if (!isTag(n)) continue
    if (test(n)) return n
    const inner = find(n.children, test)
    if (inner) return inner
  }
  return null
}

function findAll(nodes: ChildNode[], test: (el: Element) => boolean, out: Element[] = []): Element[] {
  for (const n of nodes) {
    if (!isTag(n)) continue
    if (test(n)) out.push(n)
    else findAll(n.children, test, out)
  }
  return out
}

function textOf(nodes: ChildNode[]): string {
  return nodes.map(n => isText(n) ? n.data : isTag(n) ? textOf(n.children) : '').join('')
}

function blocks(nodes: ChildNode[], ctx: Ctx): TiptapNode[] {
  const out: TiptapNode[] = []
  let run: ChildNode[] = []
  const flush = () => {
    if (run.length) out.push(...paragraphs(inlines(run, [], ctx)))
    run = []
  }
  for (const node of nodes) {
    if (isComment(node)) {
      const expanded = blockComment(node.data, ctx)
      if (expanded.length) {
        flush()
        out.push(...expanded)
      }
      continue
    }
    if (!isTag(node)) {
      if (isText(node)) run.push(node)
      continue
    }
    const tag = node.name.toLowerCase()
    if (!BLOCK_TAGS.has(tag) && !DROPPED.has(tag) && tag !== 'img' && tag !== 'iframe') {
      run.push(node)
      continue
    }
    flush()
    out.push(...block(node, tag, ctx))
  }
  flush()
  return out
}

function block(node: Element, tag: string, ctx: Ctx): TiptapNode[] {
  const h = /^h([1-6])$/.exec(tag)
  if (tag === 'p') return paragraphs(inlines(node.children, blockColor(node), ctx))
  if (h) return heading(node, Number(h[1]), ctx)
  if (tag === 'ul' || tag === 'ol') return list(node, ctx)
  if (tag === 'blockquote') return quote(node, ctx)
  if (tag === 'img') return image(node, ctx)
  if (tag === 'iframe') return iframe(node, ctx)
  if (tag === 'audio' || tag === 'video') return media(node, tag, ctx)
  if (tag === 'hr') return hasClass(node, 'wp-block-separator') ? [{ type: 'horizontalRule' }] : []
  if (tag === 'pre') return paragraphs(inlines(node.children, [], ctx, { pre: true }))
  if (tag === 'table') return table(node, ctx)
  if (tag === 'details') return details(node, ctx)
  if (DROPPED.has(tag)) {
    if (!SILENT.has(tag)) ctx.unknown.add(tag)
    return []
  }
  if (hasClass(node, 'wp-block-spacer', 'gb-block-spacer')) return []
  if (tag === 'figure' && hasClass(node, 'wp-block-embed')) return embed(node, ctx)
  if (tag === 'figure' && hasClass(node, 'wp-block-audio')) return audioFigure(node, ctx)
  if (hasClass(node, 'wp-block-columns')) return columns(node.children.filter(isColumn('wp-block-column')).map(c => ({ el: c, width: flexBasis(c) })), ctx)
  if (hasClass(node, 'wp-block-genesis-blocks-gb-columns')) return gbColumns(node, ctx)
  if (hasClass(node, 'gb-block-notice')) return notice(node, ctx)
  if (hasClass(node, 'gb-block-testimonial')) return testimonial(node, ctx)
  if (hasClass(node, 'wp-block-file')) return file(node)
  return blocks(node.children, ctx)
}

// Blocks whose HTML is saved in the post; written self-closing they are empty.
const STATIC_BLOCKS = new Set(['paragraph', 'heading', 'list', 'list-item', 'quote', 'pullquote', 'image', 'gallery', 'html', 'embed', 'file', 'audio', 'video', 'cover', 'media-text', 'spacer', 'separator', 'group', 'columns', 'column', 'buttons', 'button', 'verse', 'preformatted', 'code', 'table', 'details', 'freeform', 'genesis-blocks/gb-layouts'])

// A block comment without HTML of its own (`<!-- wp:name {…} /-->`) is a
// dynamic block WordPress renders on the fly; only reusable blocks can be
// expanded here.
function blockComment(data: string, ctx: Ctx): TiptapNode[] {
  const m = /^\s*wp:([a-z0-9-]+(?:\/[a-z0-9-]+)?)(?:\s+(\{[\s\S]*\}))?\s*\/\s*$/.exec(data)
  if (!m || STATIC_BLOCKS.has(m[1]!)) return []
  const name = m[1]!
  if (name === 'block') {
    let ref = 0
    try {
      ref = Number(JSON.parse(m[2] ?? '{}').ref) || 0
    } catch {}
    const html = ref && !ctx.refs.includes(ref) ? ctx.opts.reusableBlock?.(ref) : null
    if (html) {
      ctx.refs.push(ref)
      const out = blocks(parse(html), ctx)
      ctx.refs.pop()
      return out
    }
  }
  ctx.unknown.add(`wp:${name}`)
  return []
}

// Splits inline content at the blocks found inside it (an image in a
// paragraph or link) into paragraphs and those blocks.
function paragraphs(items: TiptapNode[]): TiptapNode[] {
  return segments(items).flatMap((s) => {
    if (!Array.isArray(s)) return [s]
    const content = tidy(s)
    return content.length ? [{ type: 'paragraph', content }] : []
  })
}

function segments(items: TiptapNode[]): (TiptapNode[] | TiptapNode)[] {
  const out: (TiptapNode[] | TiptapNode)[] = []
  let run: TiptapNode[] = []
  for (const n of items) {
    if (n.type === 'text' || n.type === 'hardBreak') {
      run.push(n)
    } else {
      if (run.length) out.push(run)
      run = []
      out.push(n)
    }
  }
  if (run.length) out.push(run)
  return out
}

// Long headings are prompts set large, not section titles.
function heading(node: Element, level: number, ctx: Ctx): TiptapNode[] {
  const color = blockColor(node)
  const items = inlines(node.children, color, ctx, { plain: true })
  if ([...plain(tidy(items.filter(isInline)))].length > 80) return paragraphs(inlines(node.children, [{ type: 'bold' }, ...color], ctx))
  return segments(items).flatMap((s) => {
    if (!Array.isArray(s)) return [s]
    const content = tidy(s)
    return content.length ? [{ type: 'heading', attrs: { level: Math.max(2, Math.min(4, level)) }, content }] : []
  })
}

function list(node: Element, ctx: Ctx): TiptapNode[] {
  const items: TiptapNode[] = []
  for (const child of node.children) {
    if (!isTag(child)) continue
    const tag = child.name.toLowerCase()
    if (tag === 'ul' || tag === 'ol') {
      // A list straight inside a list belongs to the item before it.
      const nested = list(child, ctx)
      const last = items[items.length - 1]
      if (last) last.content!.push(...nested)
      else if (nested.length) items.push(listItem(nested))
      continue
    }
    const inner = tag === 'li' ? blocks(child.children, ctx) : block(child, tag, ctx)
    if (inner.length) items.push(listItem(inner))
  }
  if (!items.length) return []
  const start = Number(node.attribs.start)
  const ordered = node.name.toLowerCase() === 'ol'
  return [{ type: ordered ? 'orderedList' : 'bulletList', ...(ordered && start > 1 ? { attrs: { start } } : {}), content: items }]
}

// A list item starts with a paragraph in the editor's schema.
function listItem(inner: TiptapNode[]): TiptapNode {
  return { type: 'listItem', content: inner[0]?.type === 'paragraph' ? inner : [{ type: 'paragraph' }, ...inner] }
}

// A quote cited with a Bible reference is a Scripture block; any other
// citation stays as the quote's last line.
function quote(node: Element, ctx: Ctx): TiptapNode[] {
  const cites = node.children.filter((c): c is Element => isTag(c) && c.name.toLowerCase() === 'cite')
  const inner = blocks(node.children.filter(c => !cites.includes(c as Element)), ctx)
  const cite = cites.map(c => textOf(c.children)).join(' ')
  const ref = cite.trim() ? citedReference(cite) : null
  if (ref && inner.length) return [verse(ref.reference, ref.translation, unquote(inner))]
  for (const c of cites) inner.push(...paragraphs(inlines(c.children, [], ctx)))
  return inner.length ? [{ type: 'blockquote', content: inner }] : []
}

// Genesis Blocks testimonial: the quoted text, then a name and title, which
// for Scripture is the reference.
function testimonial(node: Element, ctx: Ctx): TiptapNode[] {
  const text = find(node.children, el => hasClass(el, 'gb-testimonial-text'))
  const name = find(node.children, el => hasClass(el, 'gb-testimonial-name'))
  const title = find(node.children, el => hasClass(el, 'gb-testimonial-title'))
  const inner = text ? blocks(text.children, ctx) : []
  const who = [name, title].filter(Boolean).map(el => textOf(el!.children).trim()).filter(Boolean).join(', ')
  const ref = who ? citedReference(who) : null
  if (ref && inner.length) return [verse(ref.reference, ref.translation, unquote(inner))]
  if (who) inner.push({ type: 'paragraph', content: [textNode(tokens(who.replace(/\s+/g, ' ')), [])] })
  return inner.length ? [{ type: 'blockquote', content: inner }] : []
}

// A coloured notice box: its title becomes a heading, its body stays as blocks.
function notice(node: Element, ctx: Ctx): TiptapNode[] {
  const out: TiptapNode[] = []
  for (const part of node.children) {
    if (!isTag(part)) continue
    if (hasClass(part, 'gb-notice-title')) out.push(...heading(part, 3, ctx))
    else out.push(...block(part, part.name.toLowerCase(), ctx))
  }
  return out
}

// A <details> section opens up to its content; a summary that is a Bible
// reference makes the content a Scripture block.
function details(node: Element, ctx: Ctx): TiptapNode[] {
  const summary = node.children.find((c): c is Element => isTag(c) && c.name.toLowerCase() === 'summary')
  const inner = blocks(node.children.filter(c => c !== summary), ctx)
  const ref = summary ? citedReference(textOf(summary.children)) : null
  if (ref && inner.length) return [verse(ref.reference, ref.translation, unquote(inner))]
  return [...(summary ? paragraphs(inlines(summary.children, [{ type: 'bold' }], ctx)) : []), ...inner]
}

// A table keeps its rows and cells (header cells as `tableHeader`) with their
// spans; each cell holds blocks.
function table(node: Element, ctx: Ctx): TiptapNode[] {
  const rows: TiptapNode[] = []
  for (const row of findAll(node.children, el => el.name.toLowerCase() === 'tr')) {
    const cells = row.children.filter((c): c is Element => isTag(c) && /^t[hd]$/i.test(c.name)).map((cell) => {
      const content = scripture(blocks(cell.children, ctx))
      const spans = Object.fromEntries((['colspan', 'rowspan'] as const)
        .map(k => [k, Number(cell.attribs[k])] as const).filter(([, v]) => Number.isInteger(v) && v > 1))
      return {
        type: cell.name.toLowerCase() === 'th' ? 'tableHeader' : 'tableCell',
        ...(Object.keys(spans).length ? { attrs: spans } : {}),
        content: content.length ? content : [{ type: 'paragraph' }]
      }
    })
    if (cells.length) rows.push({ type: 'tableRow', content: cells })
  }
  return rows.length ? [{ type: 'table', content: rows }] : []
}

// ── Columns ─────────────────────────────────────────────────────────────

function isColumn(cls: string) {
  return (c: ChildNode): c is Element => isTag(c) && hasClass(c, cls)
}

// A Gutenberg column's width, from `flex-basis` when it is a percentage.
function flexBasis(el: Element): number | null {
  const m = /flex-basis:\s*([\d.]+)%/.exec(el.attribs.style ?? '')
  const w = m ? Number(m[1]) : NaN
  return w > 0 && w <= 100 ? w : null
}

// Genesis Blocks columns, whose layout class gives the widths.
const GB_LAYOUTS: Record<string, number[]> = {
  'gb-2-col-wideleft': [67, 33], 'gb-2-col-wideright': [33, 67],
  'gb-3-col-widecenter': [25, 50, 25], 'gb-3-col-wideleft': [50, 25, 25], 'gb-3-col-wideright': [25, 25, 50]
}

function gbColumns(node: Element, ctx: Ctx): TiptapNode[] {
  const cols = findAll(node.children, el => hasClass(el, 'gb-block-layout-column'))
  const layout = classes(node).map(c => GB_LAYOUTS[c]).find(Boolean)
  return columns(cols.map((el, i) => ({ el, width: layout?.length === cols.length ? layout[i]! : null })), ctx)
}

// Side-by-side columns: empty ones are dropped, a single column stays as its
// blocks, and more than three are split into rows of two or three, the most
// the editor holds. A column without a width shares what the others leave.
function columns(cols: { el: Element, width: number | null }[], ctx: Ctx): TiptapNode[] {
  const kept = cols.map(c => ({ width: c.width, content: scripture(blocks(c.el.children, ctx)) })).filter(c => c.content.length)
  if (kept.length < 2) return kept.flatMap(c => c.content)
  const given = kept.reduce((sum, c) => sum + (c.width ?? 0), 0)
  const open = kept.filter(c => c.width === null).length
  const share = open && given < 100 ? (100 - given) / open : null
  const out: TiptapNode[] = []
  for (let i = 0; i < kept.length;) {
    const n = kept.length - i === 4 ? 2 : Math.min(3, kept.length - i)
    const row = kept.slice(i, i + n)
    i += n
    if (row.length === 1) {
      out.push(...row[0]!.content)
      continue
    }
    const widths = row.map(c => c.width ?? share)
    const equal = widths.some(w => w === null) || widths.every(w => Math.abs(w! - widths[0]!) < 0.5)
    out.push({
      type: 'columns',
      ...(equal ? {} : { attrs: { widths: widths.map(w => Math.round(w! * 100) / 100) } }),
      content: row.map(c => ({ type: 'column', content: c.content }))
    })
  }
  return out
}

// A file block: a link to the file, or a player for an audio file.
function file(node: Element): TiptapNode[] {
  const link = find(node.children, el => el.name.toLowerCase() === 'a' && !!el.attribs.href && !hasClass(el, 'wp-block-file__button'))
    ?? find(node.children, el => el.name.toLowerCase() === 'a' && !!el.attribs.href)
  if (!link) return []
  const href = link.attribs.href!.trim()
  const label = textOf(link.children).replace(/\s+/g, ' ').trim()
  if (AUDIO_FILE.test(pathOf(href))) return [audio(href, label)]
  return linkParagraph(href, label)
}

// ── Media ───────────────────────────────────────────────────────────────

// An image, with the link around it (`href`) when there is one.
function image(node: Element, ctx: Ctx, href?: string): TiptapNode[] {
  const src = (node.attribs.src || node.attribs['data-src'] || '').trim()
  if (!src || src.startsWith('data:')) {
    if (src) ctx.unknown.add('img:data')
    return []
  }
  return [{ type: 'image', attrs: { src, alt: (node.attribs.alt ?? '').trim(), ...(href ? { href } : {}) } }]
}

const AUDIO_FILE = /\.(mp3|m4a|ogg|oga|wav)$/i

function pathOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url.split(/[?#]/)[0] ?? ''
  }
}

function audio(src: string, title: string): TiptapNode {
  return { type: 'audio', attrs: { src, title: title || null } }
}

// An audio block: the player, titled by its caption.
function audioFigure(node: Element, ctx: Ctx): TiptapNode[] {
  const player = find(node.children, el => el.name.toLowerCase() === 'audio')
  const src = player ? audioSrc(player) : ''
  const caption = node.children.find((c): c is Element => isTag(c) && c.name.toLowerCase() === 'figcaption')
  if (!src) return caption ? paragraphs(inlines(caption.children, [], ctx)) : []
  return [audio(src, caption ? textOf(caption.children).replace(/\s+/g, ' ').trim() : '')]
}

function audioSrc(el: Element): string {
  return (el.attribs.src || find(el.children, s => s.name.toLowerCase() === 'source' && !!s.attribs.src)?.attribs.src || '').trim()
}

// A YouTube or Vimeo link becomes a video block; any other media stays as a
// link to it.
function video(url: string, kind: string, ctx: Ctx, label = ''): TiptapNode[] {
  const v = videoEmbed(url)
  if (v && v.kind !== 'file') return [{ type: 'youtube', attrs: { src: url } }]
  ctx.unknown.add(kind)
  return linkParagraph(url, label)
}

function embed(node: Element, ctx: Ctx): TiptapNode[] {
  const wrapper = find(node.children, el => hasClass(el, 'wp-block-embed__wrapper')) ?? node
  const url = /https?:\/\/[^\s<>"]+/.exec(textOf(wrapper.children))?.[0]
  const provider = classes(node).find(c => c.startsWith('is-provider-'))?.slice('is-provider-'.length)
  const caption = node.children.find((c): c is Element => isTag(c) && c.name.toLowerCase() === 'figcaption')
  const out = url ? video(url, `embed:${provider ?? hostOf(url)}`, ctx) : []
  return caption ? [...out, ...paragraphs(inlines(caption.children, [], ctx))] : out
}

function iframe(node: Element, ctx: Ctx): TiptapNode[] {
  const src = (node.attribs.src || node.attribs['data-src'] || '').trim()
  if (!src) return []
  const host = hostOf(src)
  if (/(^|\.)google\.[a-z.]+$/.test(host) && /\/maps(\/|$|\?)/.test(new URL(src).pathname + '?')) {
    return [{ type: 'paragraph', content: [textNode(ctx.opts.mapLabel ?? 'View map', [{ type: 'link', attrs: { href: mapLink(src) } }])] }]
  }
  return video(src, `iframe:${host}`, ctx, (node.attribs.title ?? '').trim())
}

// The Google Maps page for an embedded map: the place's coordinates or name
// from an embed's `pb` parameter, its `q`, or a My Maps map by `mid`.
export function mapLink(embed: string): string {
  let u: URL
  try {
    u = new URL(embed)
  } catch {
    return embed
  }
  const pb = u.searchParams.get('pb') ?? ''
  const lng = /!2d(-?[\d.]+)/.exec(pb)?.[1]
  const lat = /!3d(-?[\d.]+)/.exec(pb)?.[1]
  const name = /!2s([^!]+)/.exec(pb)?.[1]
  const q = u.searchParams.get('q')
  const mid = u.searchParams.get('mid')
  if (mid) return `https://www.google.com/maps/d/viewer?mid=${encodeURIComponent(mid)}`
  if (lat && lng) return `https://www.google.com/maps?q=${lat},${lng}`
  if (q) return `https://www.google.com/maps?q=${encodeURIComponent(q)}`
  if (name) return `https://www.google.com/maps?q=${encodeURIComponent(decodeURIComponentSafe(name.replace(/\+/g, ' ')))}`
  return u.toString().replace('/maps/embed', '/maps')
}

function media(node: Element, tag: string, ctx: Ctx): TiptapNode[] {
  const src = audioSrc(node)
  if (!src) return []
  return tag === 'video' ? video(src, 'video', ctx) : [audio(src, (node.attribs.title ?? '').trim())]
}

function linkParagraph(href: string, label: string): TiptapNode[] {
  const text = label || decodeURIComponentSafe(href.split('/').pop() || href) || href
  return [{ type: 'paragraph', content: [textNode(text, [{ type: 'link', attrs: { href } }])] }]
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return 'invalid'
  }
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

// ── Inline content ──────────────────────────────────────────────────────

function isInline(n: TiptapNode): boolean {
  return n.type === 'text' || n.type === 'hardBreak'
}

function inlines(nodes: ChildNode[], marks: Mark[], ctx: Ctx, mode: InlineMode = {}): TiptapNode[] {
  const out: TiptapNode[] = []
  for (const node of nodes) {
    if (isText(node)) {
      if (mode.pre) {
        node.data.split(/\r?\n/).forEach((line, i) => {
          if (i) out.push({ type: 'hardBreak' })
          const text = line.replace(/\s+/g, ' ')
          if (text) out.push(textNode(tokens(text), marks))
        })
      } else {
        const text = node.data.replace(/\s+/g, ' ')
        if (text) out.push(textNode(tokens(text), marks))
      }
      continue
    }
    if (!isTag(node)) continue
    const tag = node.name.toLowerCase()
    if (tag === 'br') {
      out.push({ type: 'hardBreak' })
      continue
    }
    if (tag === 'img') {
      out.push(...image(node, ctx, marks.find(m => m.type === 'link')?.attrs?.href as string | undefined))
      continue
    }
    if (tag === 'iframe' || BLOCK_TAGS.has(tag) || DROPPED.has(tag)) {
      out.push(...block(node, tag, ctx))
      continue
    }
    let m = withColors(marks, node)
    const href = node.attribs.href?.trim()
    if (tag === 'a' && href && !/^javascript:/i.test(href)) {
      if (!m.some(k => k.type === 'link')) m = [...m, { type: 'link', attrs: { href } }]
    } else if (tag === 'sup') {
      // Footnote markers like [a] are dropped.
      if (/^[[(]\s*[a-z0-9]{1,3}\s*[\])]$/i.test(textOf(node.children).trim())) continue
      m = withMark(m, { type: 'superscript' })
    } else if (tag === 'sub') {
      m = withMark(m, { type: 'subscript' })
    } else if (!mode.plain) {
      const type = ({ strong: 'bold', b: 'bold', em: 'italic', i: 'italic', u: 'underline', s: 'strike', strike: 'strike', del: 'strike' } as Record<string, string>)[tag]
      if (type && !m.some(k => k.type === type)) m = [...m, { type }]
    }
    out.push(...inlines(node.children, m, ctx, mode))
  }
  return out
}

// ── Colors ──────────────────────────────────────────────────────────────

// WordPress's default palette, by the slug its `has-<slug>-color` classes use.
const PRESETS: Record<string, string> = {
  'black': '#000000', 'cyan-bluish-gray': '#abb8c3', 'white': '#ffffff', 'pale-pink': '#f78da7', 'vivid-red': '#cf2e2e',
  'luminous-vivid-orange': '#ff6900', 'luminous-vivid-amber': '#fcb900', 'light-green-cyan': '#7bdcb5', 'vivid-green-cyan': '#00d084',
  'pale-cyan-blue': '#8ed1fc', 'vivid-cyan-blue': '#0693e3', 'vivid-purple': '#9b51e0'
}
const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', orange: '#ffa500',
  purple: '#800080', gray: '#808080', grey: '#808080', navy: '#000080', maroon: '#800000', teal: '#008080', brown: '#a52a2a'
}

// A CSS color as `#rrggbb`, or null when it is transparent or not a color.
function cssColor(raw: string | undefined): string | null {
  const v = (raw ?? '').replace(/!important/i, '').trim().toLowerCase()
  const preset = /^var\(--wp--preset--color--([a-z0-9-]+)\)$/.exec(v)
  if (preset) return PRESETS[preset[1]!] ?? null
  if (NAMED[v]) return NAMED[v]!
  let hex = /^#([0-9a-f]{3,8})$/.exec(v)?.[1]
  if (hex && (hex.length === 3 || hex.length === 4)) hex = [...hex].map(c => c + c).join('')
  if (hex && (hex.length === 6 || hex.length === 8)) return hex.length === 8 && hex.endsWith('00') ? null : `#${hex.slice(0, 6)}`
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+%?)\s*)?\)$/.exec(v)
  if (!rgb || (rgb[4] !== undefined && parseFloat(rgb[4]) === 0)) return null
  return `#${rgb.slice(1, 4).map(n => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')}`
}

function channels(hex: string): number[] {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
}

// Near-black gray is the page's own text color, and near-white text or
// highlight only showed on a background the import doesn't keep.
const isDefaultText = (hex: string) => Math.max(...channels(hex)) <= 0x40 && Math.max(...channels(hex)) - Math.min(...channels(hex)) <= 0x20
const isWhite = (hex: string, min: number) => Math.min(...channels(hex)) >= min

function styleProp(el: Element, prop: string): string | undefined {
  return new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i').exec(el.attribs.style ?? '')?.[1]
}

function classColors(el: Element): { color: string | null, background: string | null } {
  let color: string | null = null
  let background: string | null = null
  for (const c of classes(el)) {
    const slug = /^has-([a-z0-9-]+)-color$/.exec(c)?.[1]
    if (!slug) continue
    if (slug.endsWith('-background')) background ??= PRESETS[slug.slice(0, -'-background'.length)] ?? null
    else color ??= PRESETS[slug] ?? null
  }
  return { color, background }
}

// The text color of a paragraph or heading, as a mark for its text.
function blockColor(el: Element): Mark[] {
  const color = cssColor(styleProp(el, 'color')) ?? classColors(el).color
  return color && !isDefaultText(color) && !isWhite(color, 0xe0) ? [{ type: 'textStyle', attrs: { color } }] : []
}

// `marks` with the text color and highlight an inline element sets: a <mark>
// or <span> background is a highlight (a <mark> without one is the default
// highlight), and a text color on any inline element is kept. A <span>'s
// inline bold, italics, underline and strike-through are kept too.
function withColors(marks: Mark[], el: Element): Mark[] {
  const tag = el.name.toLowerCase()
  if (hasClass(el, 'wp-block-button__link')) return marks
  const cls = classColors(el)
  const bgRaw = styleProp(el, 'background-color') ?? styleProp(el, 'background')
  let background = tag === 'mark' || tag === 'span' ? cssColor(bgRaw) ?? cls.background : null
  if (background && isWhite(background, 0xf0)) background = null
  let color = cssColor(styleProp(el, 'color') ?? el.attribs.color) ?? cls.color
  if (color && (isDefaultText(color) || (!background && isWhite(color, 0xe0)))) color = null
  let out = marks
  if (background) out = withMark(out, { type: 'highlight', attrs: { color: background } })
  else if (tag === 'mark' && bgRaw === undefined && !cls.background && !hasClass(el, 'has-inline-color')) out = withMark(out, { type: 'highlight' })
  if (color) out = withMark(out, { type: 'textStyle', attrs: { color } })
  if (tag === 'span') {
    const decoration = styleProp(el, 'text-decoration') ?? styleProp(el, 'text-decoration-line') ?? ''
    const weight = styleProp(el, 'font-weight')?.trim() ?? ''
    if (/underline/i.test(decoration)) out = withMark(out, { type: 'underline' })
    if (/line-through/i.test(decoration)) out = withMark(out, { type: 'strike' })
    if (/^(bold|bolder|[6-9]00)$/i.test(weight)) out = withMark(out, { type: 'bold' })
    if (/italic/i.test(styleProp(el, 'font-style') ?? '')) out = withMark(out, { type: 'italic' })
  }
  return out
}

// `marks` with `mark` in place of any of its type, so an inner color wins.
function withMark(marks: Mark[], mark: Mark): Mark[] {
  return [...marks.filter(m => m.type !== mark.type), mark]
}

function textNode(text: string, marks: Mark[]): TiptapNode {
  return marks.length ? { type: 'text', text, marks } : { type: 'text', text }
}

function sameMarks(a: Mark[] | undefined, b: Mark[] | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
}

// Trims spaces at the edges and around line breaks, drops leading, trailing and
// repeated breaks, and merges neighbouring text with the same marks.
function tidy(nodes: TiptapNode[]): TiptapNode[] {
  const out: TiptapNode[] = []
  for (const node of nodes) {
    const n = { ...node }
    const prev = out[out.length - 1]
    if (n.type === 'hardBreak') {
      if (prev?.type === 'text') prev.text = prev.text!.trimEnd()
      out.push(n)
      continue
    }
    if (!prev || prev.type === 'hardBreak') n.text = n.text!.trimStart()
    else if (prev.type === 'text' && prev.text!.endsWith(' ') && n.text!.startsWith(' ')) n.text = n.text!.slice(1)
    if (prev?.type === 'text' && sameMarks(prev.marks, n.marks)) prev.text += n.text!
    else out.push(n)
  }
  let clean = out.filter(n => n.type !== 'text' || n.text !== '')
  while (clean[0]?.type === 'hardBreak') clean.shift()
  while (clean[clean.length - 1]?.type === 'hardBreak') clean.pop()
  const last = clean[clean.length - 1]
  if (last?.type === 'text') {
    last.text = last.text!.trimEnd()
    if (last.text === '') clean.pop()
  }
  clean = clean.filter((n, i) => !(n.type === 'hardBreak' && clean[i - 1]?.type === 'hardBreak'))
  return clean
}

function plain(inline: TiptapNode[]): string {
  return inline.map(n => n.text ?? '').join('').trim()
}

// ── Scripture ───────────────────────────────────────────────────────────

// A Bible reference as fuel writes it in each language, e.g. "1 John 4:16",
// "Jean 3 :21", "Johannes 3,21", "متی ۳:۵", and a translation such as ESV.
const NUM = '[0-9\\u0660-\\u0669\\u06F0-\\u06F9]+'
const VERSES = `\\s?[:,]\\s?${NUM}[ab]?(?:\\s?[-–]\\s?(?:${NUM}:)?${NUM}[ab]?)?(?:\\s?[,.&+]\\s?${NUM}[ab]?(?:[-–]${NUM}[ab]?)?)*`
const BOOK = '(?:[1-5]\\.?\\s?)?\\p{L}[\\p{L}\\p{M}.-]*'
const REF = `${BOOK}(?:\\s\\p{L}[\\p{L}\\p{M}.]*){0,2}\\s*${NUM}(?:${VERSES})?`
const REF_VERSES = `${BOOK}(?:\\s\\p{L}[\\p{L}\\p{M}.]*){0,2}\\s*${NUM}${VERSES}`
const TRANSLATION = '\\p{Lu}[\\p{Lu}0-9]{1,9}(?![\\p{L}0-9])'
const TRANSLATION_AFTER = `(?:\\s*[(（](${TRANSLATION})[)）]|\\s+(${TRANSLATION}))?`
const OPEN_QUOTE = '[“"«„「『]'
const CLOSE_QUOTE = '[”"»“」』]'
const QUOTES = /[“”"«»„「」『』]/gu
// A short label before a passage, such as "Scripture:" or "Scripture to Pray —".
const LABEL = '\\p{L}[^.!?:"“”«»\\d]{0,40}?\\s*[:：—–]\\s*'

const REF_BLOCK = new RegExp(`^(${REF})\\s*[(（](${TRANSLATION})[)）]$`, 'u')
// A line holding only a reference, such as "— Galatians 6:9 (ESV)" or "(Psalm 82:8)".
const REF_LINE = new RegExp(`^[\\s\\-–—~(\\[]*(${REF_VERSES})${TRANSLATION_AFTER}[\\s)\\].]*$`, 'u')
const CITED_REF = new RegExp(`^(${REF})${TRANSLATION_AFTER}$`, 'u')
// `Colossians 4:2-4 (ESV) - "Continue steadfastly…"`, or `Psalm 34:18 – The Lord is near…`.
const PASSAGE = new RegExp(`^(${LABEL})?(${REF_VERSES})${TRANSLATION_AFTER}\\s*[-–—:]?\\s*${OPEN_QUOTE}([\\s\\S]+?)${CLOSE_QUOTE}?$`, 'u')
const DASHED = new RegExp(`^(${LABEL})?(${REF_VERSES})${TRANSLATION_AFTER}\\s*[-–—]\\s+(\\p{L}.{20,})$`, 'u')
const OPENS = new RegExp(`(?:^\\s*|[.!?؟。！？](\\s*)|^\\s*${LABEL})(${OPEN_QUOTE})\\s?(?![.,;:!?()]\\s)`, 'gud')
const CITE = new RegExp(`(?:${CLOSE_QUOTE}?\\s*[.,]?\\s*[(（]\\s*(${REF})(?:\\s+(${TRANSLATION}))?\\s*[)）]`
  + `|${CLOSE_QUOTE}\\s*[.,]?\\s*[-–—]*\\s*(${BOOK}(?:\\s\\p{L}[\\p{L}\\p{M}.]*){0,2}\\s*${NUM}${VERSES}))`
  + `\\s*[.。۔]?\\s*(${TRANSLATION})?\\s*\\.?`, 'gu')
// A quotation's closing mark and its reference ending a line, after a dash
// or in brackets.
const END_CITE = new RegExp(`${CLOSE_QUOTE}\\s*[.,]?\\s*(?:[(（]\\s*(${REF_VERSES})(?:\\s+(${TRANSLATION}))?\\s*[)）]|[-–—]+\\s*(${REF_VERSES})${TRANSLATION_AFTER})\\s*\\.?\\s*$`, 'u')
// A reference ending a paragraph, in brackets or after a dash.
const END_REF = new RegExp(`^([\\s\\S]*?\\S)\\s*(?:[(（]\\s*(${REF_VERSES})(?:\\s+(${TRANSLATION}))?\\s*[)）]|\\s[-–—]+\\s*(${REF_VERSES})${TRANSLATION_AFTER})\\s*\\.?\\s*$`, 'u')
const QUOTED_LINE = new RegExp(`^${OPEN_QUOTE}([\\s\\S]+)${CLOSE_QUOTE}\\s*\\.?$`, 'u')
const REF_BEFORE = new RegExp(`(?:^|\\s)((?:\\p{Lu}[\\p{L}\\p{M}.-]*\\s){0,2}${BOOK}\\s${NUM}(?:${VERSES})?)\\s*[:：]$`, 'u')

type Line = TiptapNode[]

// Turns quoted Bible passages into Scripture (`verse`) blocks: a reference
// block (or line) followed by the passage, a passage followed by a line holding
// its reference, a paragraph that starts with a reference and then the passage,
// and a quotation followed by its reference within a paragraph line. A passage
// is quoted or set in italics; a quotation inside a sentence stays where it is.
function scripture(blocks: TiptapNode[]): TiptapNode[] {
  const out: TiptapNode[] = []
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!
    const next = blocks[i + 1]
    const ref = refBlock(b)
    const line = ref ? null : refLineBlock(b)
    if (ref && next && !refBlock(next)
      && (next.type === 'paragraph' || (next.type === 'heading' && next.attrs?.level === 4))) {
      out.push(verse(ref[1]!, ref[2]!, unquote([{ type: 'paragraph', content: next.content }])))
      i++
    } else if (line && next?.type === 'paragraph' && !refLineBlock(next) && isPassage(next.content ?? [])) {
      out.push(verse(line.reference, line.translation, unquote([{ type: 'paragraph', content: next.content }])))
      i++
    } else if (b.type === 'paragraph') {
      out.push(...paragraphVerses(lines(b.content ?? [])))
    } else {
      out.push(b)
    }
  }
  return out
}

function lines(inline: TiptapNode[]): Line[] {
  const out: Line[] = [[]]
  for (const n of inline) {
    if (n.type === 'hardBreak') out.push([])
    else out[out.length - 1]!.push(n)
  }
  return out
}

function joinLines(ls: Line[]): TiptapNode[] {
  return ls.flatMap((l, k) => (k ? [{ type: 'hardBreak' }, ...l] : l))
}

function paragraphOf(ls: Line[]): TiptapNode[] {
  const content = tidy(joinLines(ls))
  return content.length ? [{ type: 'paragraph', content }] : []
}

function paragraphVerses(ls: Line[]): TiptapNode[] {
  if (!ls.some(l => l.length)) return []
  return passageParagraph(ls) ?? refLineVerses(ls) ?? endRefVerse(ls) ?? quotedVerses(ls)
}

// The reference and translation of a block holding only those, or null.
function refBlock(b: TiptapNode): RegExpExecArray | null {
  if (b.type !== 'paragraph' && b.type !== 'heading') return null
  const m = REF_BLOCK.exec(plain(b.content ?? []))
  return m && isBible(m[1]!) ? m : null
}

function refLineBlock(b: TiptapNode): { reference: string, translation: string } | null {
  if ((b.type !== 'paragraph' && b.type !== 'heading') || b.content?.some(n => n.type === 'hardBreak')) return null
  return refLine(b.content ?? [])
}

function refLine(line: Line): { reference: string, translation: string } | null {
  const m = REF_LINE.exec(plain(line).replace(/\s+/g, ' '))
  return m && isBible(m[1]!) ? { reference: m[1]!, translation: m[2] ?? m[3] ?? '' } : null
}

// A citation such as "– ROMANS 13:11-12 ESV" or "Joel 2:28 (NIV)".
function citedReference(text: string): { reference: string, translation: string } | null {
  const t = text.replace(/\s+/g, ' ').replace(/^[\s\-–—~]+/, '').replace(/[\s.]+$/, '')
  const m = CITED_REF.exec(t)
  return m && isBible(m[1]!) ? { reference: m[1]!, translation: m[2] ?? m[3] ?? '' } : null
}

// Some campaigns quote the Qur'an by surah, e.g. "Al-Baqarah 2:185".
const SURAH = /^(?:Surah?\s+|Sura\s+)?(?:A[lnrstdz]h?-|(?:Hud|Ibrahim|Maryam|Luqman|Yusuf|Muhammad|Ta-?Ha|Ya-?Sin|Fatiha|Nisa|Imran)\b)|Qur'?an|Coran|Corán|Alcorão|سورة|سوره|القرآن/iu

function isBible(reference: string): boolean {
  return !SURAH.test(reference)
}

// One quotation from start to end. Single quotes inside, other than
// apostrophes, mean the outer ones aren't a pair.
function quotedWhole(t: string): boolean {
  const inner = t.replace(/[.,;]$/, '').slice(1, -1)
  if (/^[“"«„「『]/u.test(t) && /[”"»“」』][.,;]?$/u.test(t)) return !closedEarly(t[0]!, inner)
  return /^['‘]/u.test(t) && /['’][.,;]?$/u.test(t) && !/(?<!\p{L})['‘’]|['‘’](?!\p{L})/u.test(inner)
}

// Quoted, or in italics throughout, and not itself citing a reference.
function isPassage(nodes: TiptapNode[]): boolean {
  const t = plain(nodes)
  if ([...t].length < 12 || lines(nodes).some(l => END_REF.test(plain(l)))) return false
  if (quotedWhole(t)) return true
  const texts = nodes.filter(n => n.type === 'text' && n.text!.trim())
  return texts.length > 0 && texts.every(n => n.marks?.some(m => m.type === 'italic') && !n.marks.some(m => m.type === 'link'))
}

// A paragraph that starts with a reference, then the passage: quoted, or
// after a dash on a single line.
function passageParagraph(ls: Line[]): TiptapNode[] | null {
  const text = ls.map(l => plain(l).replace(/\s+/g, ' ')).join('\n').trim()
  let m = PASSAGE.exec(text)
  if (m && ls.length > 1 && !/[”"»“」』][.,]?$/u.test(text)) m = null
  if (!m && ls.length === 1) m = DASHED.exec(text)
  if (!m || !isBible(m[2]!)) return null
  // "Act 6:1-7" is a typo for Acts.
  const ref = m[2]!.replace(/:\s/g, ':').replace(/^Act (?=\d)/, 'Acts ')
  const body = m[5]!.replace(/[”"\s]+$/u, '').split('\n')
  const label = m[1]?.trim()
  const firstMarks = ls[0]!.find(n => n.type === 'text')?.marks ?? []
  return [
    ...(label ? [{ type: 'paragraph', content: [textNode(label, firstMarks.filter(k => k.type !== 'link'))] }] : []),
    verse(ref, m[3] ?? m[4] ?? '', [{ type: 'paragraph', content: tidy(body.flatMap((l, i) => [...(i ? [{ type: 'hardBreak' }] : []), textNode(l.trim(), [])])) }])
  ]
}

// A line holding only a reference, after its passage or before it.
function refLineVerses(ls: Line[]): TiptapNode[] | null {
  for (let p = 0; p < ls.length; p++) {
    const ref = refLine(ls[p]!)
    if (!ref) continue
    for (let s = 0; s < p; s++) {
      const passage = ls.slice(s, p)
      if (isPassage(joinLines(passage))) {
        return [...paragraphVerses(ls.slice(0, s)), verse(ref.reference, ref.translation, unquote(paragraphOf(passage))), ...paragraphVerses(ls.slice(p + 1))]
      }
    }
    for (let k = ls.length; k > p + 1; k--) {
      const passage = ls.slice(p + 1, k)
      if (isPassage(joinLines(passage))) {
        return [...paragraphVerses(ls.slice(0, p)), verse(ref.reference, ref.translation, unquote(paragraphOf(passage))), ...paragraphVerses(ls.slice(k))]
      }
    }
  }
  return null
}

// A paragraph that is all passage, ending with its reference in brackets or
// after a dash: quoted, or in italics with the reference set apart.
function endRefVerse(ls: Line[]): TiptapNode[] | null {
  const last = ls[ls.length - 1]!
  if (!last.every(n => n.type === 'text')) return null
  const m = END_REF.exec(last.map(n => n.text).join(''))
  const ref = m ? m[2] || m[4]! : ''
  if (!m || !isBible(ref)) return null
  const passage = [...ls.slice(0, -1), sliceLine(last, 0, m[1]!.length)]
  if (passage.some(l => END_REF.test(plain(l)))) return null
  const t = plain(joinLines(passage))
  const quoted = quotedWhole(t)
  const italic = (n: TiptapNode) => !!n.marks?.some(k => k.type === 'italic')
  if (!quoted && !(isPassage(joinLines(passage)) && !sliceLine(last, m[1]!.length, Infinity).some(n => n.text!.trim() && italic(n)))) return null
  return [verse(ref, m[3] || m[5] || m[6] || '', unquote(paragraphOf(passage)))]
}

// The part of a line between two offsets of its text, keeping marks.
function sliceLine(line: Line, from: number, to: number): Line {
  const out: Line = []
  let at = 0
  for (const n of line) {
    const text = n.text ?? ''
    const a = Math.max(from, at)
    const b = Math.min(to, at + text.length)
    if (a < b) out.push({ ...n, text: text.slice(a - at, b - at) })
    at += text.length
  }
  return out
}

// Splits a paragraph's lines into paragraphs and verses. A quotation followed
// by its reference, e.g. «…» (Luc 11 : 9), becomes a verse when it starts the
// line, a sentence or follows a label, or when it ends a line that only adds
// a short lead-in ("Jesus said to them, “…” – Matthew 28:18"); text around it
// stays in the paragraph. A quotation alone on a line takes its reference
// from the line before, as in "…from Romans 12:".
function quotedVerses(ls: Line[]): TiptapNode[] {
  const out: TiptapNode[] = []
  let run: Line[] = []
  const flush = () => {
    out.push(...paragraphOf(run))
    run = []
  }
  ls.forEach((line, k) => {
    const text = line.map(n => n.text ?? '').join('').replace(/[\u200E\u200F]/g, ' ')
    let found = cited(text) ?? trailingCite(text)
    if (!found && k > 0) {
      const q = QUOTED_LINE.exec(text.trim())
      const r = q ? REF_BEFORE.exec(plain(ls[k - 1]!)) : null
      if (q && r) found = { leadTo: 0, body: q[1]!, ref: r[1]!, translation: '', restFrom: text.length }
    }
    if (!found) {
      run.push(line)
      return
    }
    run.push(sliceLine(line, 0, found.leadTo))
    flush()
    out.push(verse(found.ref, found.translation, [{ type: 'paragraph', content: [textNode(found.body.trim(), [])] }]))
    run.push(sliceLine(line, found.restFrom, text.length))
  })
  flush()
  return out
}

interface Cited {
  leadTo: number
  body: string
  ref: string
  translation: string
  restFrom: number
}

// The first quotation in a line that starts the line or a sentence and is
// followed by a reference, with the text before and after it.
function cited(text: string): Cited | null {
  for (const open of text.matchAll(OPENS)) {
    const quoteAt = open.indices![2]![0]
    const quote = open[2]!
    // A quote mark right after a full stop opens a quotation only if the quotes before it are paired.
    if (quoteAt > 0 && !open[1] && (text.slice(0, quoteAt).match(QUOTES)?.length ?? 0) % 2) continue
    const start = open.index + open[0].length
    let from = start
    let r: RegExpExecArray | null
    let body = ''
    do {
      CITE.lastIndex = from
      r = CITE.exec(text)
      if (!r) break
      body = text.slice(start, r.index)
      from = r.index + Math.max(1, r[0].length)
    } while (!/\p{L}/u.test(body))
    if (!r || closedEarly(quote, body) || !isBible(r[1] || r[3]!)) continue
    return { leadTo: quoteAt, body, ref: r[1] || r[3]!, translation: r[2] || r[4] || '', restFrom: r.index + r[0].length }
  }
  return null
}

// A line that ends with a quotation and its reference, introduced by a comma
// or colon ("Jesus said to them, “…” – Matthew 28:18") or by a verse number.
function trailingCite(text: string): Cited | null {
  const m = END_CITE.exec(text)
  if (!m || !isBible(m[1] || m[3]!)) return null
  const close = m.index
  for (const open of text.slice(0, close).matchAll(new RegExp(OPEN_QUOTE, 'gu'))) {
    const lead = text.slice(0, open.index)
    if (!/(^|[,:،：]|^\s*[0-9]+[ab]?)\s*$/u.test(lead) || (lead.match(QUOTES)?.length ?? 0) % 2) continue
    if (closedEarly(open[0], text.slice(open.index + 1, close))) continue
    const body = text.slice(open.index + 1, close)
    if (!/\p{L}/u.test(body)) continue
    return { leadTo: /^\s*[0-9]+[ab]?\s*$/.test(lead) ? 0 : open.index, body, ref: m[1] || m[3]!, translation: m[2] || m[4] || m[5] || '', restFrom: text.length }
  }
  return null
}

const CLOSES: Record<string, string> = { '“': '”', '"': '"', '«': '»', '„': '“', '「': '」', '『': '』' }

// Whether a quotation opened with `open` closes partway through `body`, so the
// reference after it belongs to a later quotation.
function closedEarly(open: string, body: string): boolean {
  const close = CLOSES[open]!
  const chars = [...body]
  let depth = 1
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!
    // A straight quote opens a nested quotation after a space or colon, and closes one otherwise.
    const opens = open === close ? /[\s:]/u.test(chars[i - 1] ?? ' ') && !/\s/u.test(chars[i + 1] ?? ' ') : true
    if (c === open && opens) depth++
    else if (c === close) depth--
    if (depth === 0 && /\p{L}/u.test(chars.slice(i + 1).join(''))) return true
  }
  return false
}

// Drops the quote marks around a passage that is quoted as a whole.
function unquote(content: TiptapNode[]): TiptapNode[] {
  const texts: TiptapNode[] = []
  const walk = (n: TiptapNode) => {
    if (n.type === 'text') texts.push(n)
    n.content?.forEach(walk)
  }
  content.forEach(walk)
  const first = texts[0]
  const last = texts[texts.length - 1]
  if (!first || !last) return content
  const all = texts.map(t => t.text!).join('').trim()
  if (all.length < 3 || !quotedWhole(all)) return content
  const strip = (nodes: TiptapNode[]): TiptapNode[] => nodes.map((n) => {
    const next = n.content ? { ...n, content: strip(n.content) } : { ...n }
    if (n === first) next.text = next.text!.replace(/^\s*[“"«„「『'‘]\s*/u, '')
    if (n === last) next.text = next.text!.replace(/\s*[”"»“」』'’]\s*([.,;]?)\s*$/u, '$1')
    return next
  }).filter(n => n.type !== 'text' || n.text !== '')
  return strip(content)
}

// Words some writers put before a reference, as in "Read Romans 12:1-2".
const REF_LEAD = /^(?:Read|Meditate on|See|cf\.?|Compare|adapted from|Lee|Lea|Leer|Lisez|Lire|Leia|Ler|Lies|يقول|تقول)\s+(?=\S)/iu

function verse(reference: string, translation: string, content: TiptapNode[]): TiptapNode {
  const ref = reference.trim().replace(REF_LEAD, '')
  return { type: 'verse', attrs: { reference: ref, translation: translation.trim() ? translation.trim() : null }, content }
}
