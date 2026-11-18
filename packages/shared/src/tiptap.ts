// One Tiptap renderer for prayer content, landing sections and email. Covers
// every node the editor offers, including Scripture verses. `web` output uses
// classes styled by the public site; `email` output uses inline styles.
import type { TiptapDoc, TiptapNode } from './db/schema'
import { emailT } from './i18n/email'
import { getLanguage } from './languages'
import { videoEmbed } from './video'

export type RenderMode = 'web' | 'email'

export interface RenderOptions {
  mode?: RenderMode
  // Placeholder values: `{site_name}` in text becomes vars.site_name.
  vars?: Record<string, string>
  // Brand color for links and buttons in email.
  color?: string
  // Language of an email: words the renderer adds (an audio's Listen link)
  // and which side of a column the gap goes on.
  lang?: string
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function safeUrl(url: unknown): string {
  if (typeof url !== 'string') return '#'
  const u = url.trim()
  if (/^(https?:|mailto:|tel:|\/|#)/i.test(u)) return escapeHtml(u)
  return '#'
}

// A media file's address: a web address or a path on this site.
function safeSrc(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const u = url.trim()
  return /^(https?:\/\/|\/(?!\/))\S+$/i.test(u) ? escapeHtml(u) : null
}

// Each column's share of the row: `widths` when it gives a positive number for
// every column, else equal shares.
export function columnWidths(widths: unknown, count: number): number[] {
  const valid = Array.isArray(widths) && widths.length === count && widths.every(w => typeof w === 'number' && Number.isFinite(w) && w > 0)
  return valid ? widths as number[] : Array.from({ length: count }, () => 1)
}

export function safeColor(color: unknown): string | null {
  return typeof color === 'string' && /^(#[0-9a-f]{3,8}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|[a-z]+)$/i.test(color) ? color : null
}

export function fillVars(text: string, vars?: Record<string, string>): string {
  if (!vars) return text
  return text.replace(/\{([a-z_]+)\}/g, (m, key: string) => (key in vars ? vars[key]! : m))
}

const EMAIL = {
  p: 'margin:0 0 16px;font-size:16px;line-height:1.6;',
  h: (level: number) => `margin:24px 0 12px;font-weight:600;line-height:1.3;font-size:${({ 1: 26, 2: 22, 3: 19, 4: 17, 5: 15, 6: 14 } as Record<number, number>)[level] ?? 18}px;`,
  ul: 'margin:0 0 16px;padding-left:24px;',
  li: 'margin:4px 0;',
  blockquote: 'margin:16px 0;padding:8px 16px;border-left:4px solid #d4d4d8;color:#3f3f46;',
  verse: 'margin:16px 0;padding:12px 16px;border-left:4px solid #a1a1aa;background:#f4f4f5;border-radius:4px;',
  verseRef: 'display:block;margin-top:8px;font-size:13px;color:#52525b;font-style:normal;',
  pre: 'margin:16px 0;padding:12px;background:#f4f4f5;border-radius:4px;overflow-x:auto;font-size:14px;',
  hr: 'margin:24px 0;border:none;border-top:1px solid #e4e4e7;',
  img: 'max-width:100%;height:auto;margin:16px 0;border-radius:6px;',
  table: 'width:100%;border-collapse:collapse;margin:0 0 16px;',
  td: 'border:1px solid #d4d4d8;padding:8px 10px;vertical-align:top;font-size:15px;line-height:1.5;',
  th: 'border:1px solid #d4d4d8;padding:8px 10px;vertical-align:top;font-size:15px;line-height:1.5;background:#f4f4f5;font-weight:600;',
  column: 'display:inline-block;vertical-align:top;width:100%;font-size:16px;line-height:1.6;'
}

// The email body's inner width (600px less 28px padding each side) and the gap
// between columns.
const EMAIL_WIDTH = 544
const EMAIL_GUTTER = 16

export function renderNodes(nodes: TiptapNode[] | undefined, o: RenderOptions): string {
  return (nodes ?? []).map(n => renderNode(n, o)).join('')
}

function attr(n: TiptapNode, key: string): unknown {
  return n.attrs?.[key]
}

function align(n: TiptapNode): string {
  const a = attr(n, 'textAlign')
  return typeof a === 'string' && ['left', 'center', 'right', 'justify'].includes(a) ? `text-align:${a};` : ''
}

function paragraph(n: TiptapNode, o: RenderOptions, emailStyle = EMAIL.p): string {
  const email = o.mode === 'email'
  const style = (email ? emailStyle : '') + align(n)
  return `<p${style ? ` style="${style}"` : ''}>${renderNodes(n.content, o) || (email ? '&nbsp;' : '')}</p>`
}

function span(n: TiptapNode, key: 'colspan' | 'rowspan'): string {
  const v = Number(attr(n, key))
  return Number.isInteger(v) && v > 1 && v <= 1000 ? ` ${key}="${v}"` : ''
}

// Email columns sit side by side where the email is wide enough and stack
// where it isn't; mail apps that ignore inline-block (Outlook for Windows)
// stack them.
function emailColumns(cols: TiptapNode[], widths: number[], o: RenderOptions): string {
  const total = widths.reduce((a, b) => a + b, 0)
  const space = EMAIL_WIDTH - EMAIL_GUTTER * (cols.length - 1)
  const side = getLanguage(o.lang)?.dir === 'rtl' ? 'left' : 'right'
  return `<div>${cols.map((c, i) => {
    const gap = i < cols.length - 1 ? `margin-${side}:${EMAIL_GUTTER}px;` : ''
    return `<div style="${EMAIL.column}max-width:${Math.floor(space * widths[i]! / total)}px;${gap}">${renderNodes(c.content, o)}</div>`
  }).join('')}</div>`
}

export function renderNode(n: TiptapNode, o: RenderOptions): string {
  const email = o.mode === 'email'
  const inner = () => renderNodes(n.content, o)
  switch (n.type) {
    case 'doc':
      return inner()
    case 'paragraph':
      return paragraph(n, o)
    case 'heading': {
      const raw = Number(attr(n, 'level'))
      const level = raw >= 1 && raw <= 6 ? raw : 2
      const style = (email ? EMAIL.h(level) : '') + align(n)
      return `<h${level}${style ? ` style="${style}"` : ''}>${inner()}</h${level}>`
    }
    case 'bulletList':
      return `<ul${email ? ` style="${EMAIL.ul}"` : ''}>${inner()}</ul>`
    case 'orderedList': {
      const start = Number(attr(n, 'start'))
      return `<ol${start > 1 ? ` start="${start}"` : ''}${email ? ` style="${EMAIL.ul}"` : ''}>${inner()}</ol>`
    }
    case 'listItem':
      return `<li${email ? ` style="${EMAIL.li}"` : ''}>${inner()}</li>`
    case 'taskList':
      return `<ul class="task-list"${email ? ` style="${EMAIL.ul}list-style:none;padding-left:0;"` : ''}>${inner()}</ul>`
    case 'taskItem':
      return `<li${email ? ` style="${EMAIL.li}"` : ''}>${attr(n, 'checked') ? '☑' : '☐'} ${inner()}</li>`
    case 'blockquote':
      return `<blockquote${email ? ` style="${EMAIL.blockquote}"` : ''}>${inner()}</blockquote>`
    case 'verse': {
      const ref = attr(n, 'reference')
      const tr = attr(n, 'translation')
      const cite = typeof ref === 'string' && ref
        ? `<cite${email ? ` style="${EMAIL.verseRef}"` : ' class="verse-ref"'}>${escapeHtml(ref)}${typeof tr === 'string' && tr ? ` (${escapeHtml(tr)})` : ''}</cite>`
        : ''
      return `<blockquote class="verse"${email ? ` style="${EMAIL.verse}"` : ''}>${inner()}${cite}</blockquote>`
    }
    case 'codeBlock':
      return `<pre${email ? ` style="${EMAIL.pre}"` : ''}><code>${inner()}</code></pre>`
    case 'horizontalRule':
      return `<hr${email ? ` style="${EMAIL.hr}"` : ''} />`
    case 'hardBreak':
      return '<br />'
    case 'image':
    case 'imageResize': {
      const src = safeUrl(attr(n, 'src'))
      const alt = escapeHtml(String(attr(n, 'alt') ?? ''))
      const w = Number(attr(n, 'width'))
      const width = Number.isFinite(w) && w > 0 ? ` width="${Math.round(w)}"` : ''
      const img = `<img src="${src}" alt="${alt}"${width}${email ? ` style="${EMAIL.img}"` : ' loading="lazy"'} />`
      const href = typeof attr(n, 'href') === 'string' && String(attr(n, 'href')).trim() ? safeUrl(attr(n, 'href')) : '#'
      return href === '#' ? img : `<a href="${href}" target="_blank" rel="noopener">${img}</a>`
    }
    case 'table': {
      const rows = inner()
      return email
        ? `<table cellpadding="0" cellspacing="0" style="${EMAIL.table}"><tbody>${rows}</tbody></table>`
        : `<div class="table-scroll"><table><tbody>${rows}</tbody></table></div>`
    }
    case 'tableRow':
      return `<tr>${inner()}</tr>`
    case 'tableHeader':
    case 'tableCell': {
      const tag = n.type === 'tableHeader' ? 'th' : 'td'
      const blocks = n.content ?? []
      const body = email
        ? blocks.map((c, i) => c.type === 'paragraph' ? paragraph(c, o, i === blocks.length - 1 ? 'margin:0;' : 'margin:0 0 8px;') : renderNode(c, o)).join('')
        : inner()
      return `<${tag}${span(n, 'colspan')}${span(n, 'rowspan')}${email ? ` style="${tag === 'th' ? EMAIL.th : EMAIL.td}"` : ''}>${body}</${tag}>`
    }
    case 'audio': {
      const src = safeSrc(attr(n, 'src'))
      if (!src) return ''
      const title = String(attr(n, 'title') ?? '').trim()
      if (email) {
        const label = emailT(o.lang ?? 'en', 'content.listen') + (title ? `: ${title}` : '')
        return `<p style="${EMAIL.p}"><a href="${src}" style="color:${safeColor(o.color) ?? '#18181b'};text-decoration:underline;font-weight:600;">▶ ${escapeHtml(label)}</a></p>`
      }
      const caption = title ? `<figcaption>${escapeHtml(title)}</figcaption>` : ''
      return `<figure class="audio">${caption}<audio controls preload="none" src="${src}"${title ? ` aria-label="${escapeHtml(title)}"` : ''}></audio></figure>`
    }
    case 'columns': {
      const cols = (n.content ?? []).filter(c => c.type === 'column')
      if (!cols.length) return ''
      const widths = columnWidths(attr(n, 'widths'), cols.length)
      if (email) return emailColumns(cols, widths, o)
      return `<div class="columns" style="--pt-columns:${widths.map(w => `${w}fr`).join(' ')};">${cols.map(c => `<div class="column">${renderNodes(c.content, o)}</div>`).join('')}</div>`
    }
    case 'youtube': {
      const src = safeUrl(attr(n, 'src'))
      if (email) return `<p style="${EMAIL.p}"><a href="${src}">${src}</a></p>`
      // Only YouTube and Vimeo players are embedded; content is shared across sites.
      const video = videoEmbed(String(attr(n, 'src') ?? ''))
      if (!video || video.kind === 'file') return ''
      return `<div class="video"><iframe src="${escapeHtml(video.src)}" loading="lazy" allowfullscreen title="Video"></iframe></div>`
    }
    case 'button': {
      const href = safeUrl(attr(n, 'href'))
      const label = inner() || escapeHtml(String(attr(n, 'label') ?? ''))
      if (!label) return ''
      const color = safeColor(o.color) ?? '#18181b'
      return email
        ? `<p style="text-align:center;margin:24px 0;"><a href="${href}" style="display:inline-block;background:${color};color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">${label}</a></p>`
        : `<p class="button"><a href="${href}">${label}</a></p>`
    }
    case 'mention':
      return escapeHtml(String(attr(n, 'label') ?? attr(n, 'id') ?? ''))
    case 'text':
      return renderText(n, o)
    default:
      return inner()
  }
}

function renderText(n: TiptapNode, o: RenderOptions): string {
  let text = escapeHtml(fillVars(n.text ?? '', o.vars))
  for (const mark of n.marks ?? []) {
    switch (mark.type) {
      case 'bold': text = `<strong>${text}</strong>`; break
      case 'italic': text = `<em>${text}</em>`; break
      case 'underline': text = `<u>${text}</u>`; break
      case 'strike': text = `<s>${text}</s>`; break
      case 'code': text = `<code>${text}</code>`; break
      case 'superscript': text = `<sup>${text}</sup>`; break
      case 'subscript': text = `<sub>${text}</sub>`; break
      // On the web a stored color is a CSS variable, so the site's light and
      // dark themes can each keep its hue at a lightness that reads.
      case 'highlight': {
        const c = safeColor(mark.attrs?.color)
        if (o.mode === 'email') text = `<span style="background-color:${c ?? '#fef08a'};">${text}</span>`
        else text = c ? `<mark class="pt-mark" style="--pt-mark:${c};">${text}</mark>` : `<mark>${text}</mark>`
        break
      }
      case 'link': {
        const href = safeUrl(mark.attrs?.href)
        const style = o.mode === 'email' ? ` style="color:${safeColor(o.color) ?? '#18181b'};text-decoration:underline;"` : ''
        text = `<a href="${href}"${style} rel="noopener">${text}</a>`
        break
      }
      case 'textStyle': {
        const c = safeColor(mark.attrs?.color)
        if (c) text = o.mode === 'email' ? `<span style="color:${c};">${text}</span>` : `<span class="pt-color" style="--pt-color:${c};">${text}</span>`
        break
      }
    }
  }
  return text
}

export function tiptapToHtml(doc: TiptapDoc | null | undefined, o: RenderOptions = {}): string {
  if (!doc || !Array.isArray(doc.content)) return ''
  return renderNodes(doc.content, o)
}

// A link's address as plain text shows it: absolute web, mail and phone links
// only, without the `mailto:`/`tel:` prefix.
function textHref(href: unknown): string | null {
  if (typeof href !== 'string') return null
  const h = href.trim()
  if (/^https?:\/\/\S+$/i.test(h)) return h
  if (/^(mailto|tel):\S+$/i.test(h)) return h.replace(/^(mailto|tel):/i, '')
  return null
}

// ` (address)` after a link's words, or nothing when the words already are the address.
function linkSuffix(words: string, href: string | null): string {
  if (!href) return ''
  const bare = (s: string) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')
  return bare(words) === bare(href) ? '' : ` (${href})`
}

// Plain text of a doc, e.g. for the text part of an email: links are written
// as `words (address)`, images as `[alt]`, videos as their address, audio as
// `title (address)`, table rows as lines of cells split by ` | `.
export function tiptapToText(doc: TiptapDoc | null | undefined, vars?: Record<string, string>): string {
  if (!doc || !Array.isArray(doc.content)) return ''
  const walk = (nodes: TiptapNode[] | undefined): string => {
    let out = ''
    let link = null as { href: string | null, mark: unknown, words: string } | null
    const closeLink = () => {
      if (link) out += linkSuffix(link.words, link.href)
      link = null
    }
    for (const n of nodes ?? []) {
      const mark = n.type === 'text' ? n.marks?.find(m => m.type === 'link')?.attrs?.href : undefined
      if (link && (n.type !== 'text' || mark !== link.mark)) closeLink()
      if (n.type === 'text') {
        const text = fillVars(n.text ?? '', vars)
        if (mark !== undefined) link = link ? { ...link, words: link.words + text } : { href: textHref(mark), mark, words: text }
        out += text
      } else {
        out += node(n)
      }
    }
    closeLink()
    return out
  }
  const node = (n: TiptapNode): string => {
    if (n.type === 'hardBreak') return '\n'
    if (n.type === 'image' || n.type === 'imageResize') {
      const alt = String(n.attrs?.alt ?? '').trim()
      const href = textHref(n.attrs?.href)
      const words = alt ? `[${alt}]${href ? ` (${href})` : ''}` : href ?? ''
      return words ? `${words}\n\n` : ''
    }
    if (n.type === 'youtube') return typeof n.attrs?.src === 'string' && n.attrs.src ? `${n.attrs.src}\n\n` : ''
    if (n.type === 'audio') {
      const title = String(n.attrs?.title ?? '').trim()
      const src = textHref(n.attrs?.src)
      const words = title ? `${title}${src ? ` (${src})` : ''}` : src ?? ''
      return words ? `${words}\n\n` : ''
    }
    if (n.type === 'table') {
      const cell = (c: TiptapNode) => walk(c.content).replace(/\s+/g, ' ').trim()
      return `${(n.content ?? []).map(row => (row.content ?? []).map(cell).join(' | ')).join('\n')}\n\n`
    }
    const inner = walk(n.content)
    if (n.type === 'button') {
      const label = inner.trim() || fillVars(String(n.attrs?.label ?? ''), vars).trim()
      return label ? `${label}${linkSuffix(label, textHref(n.attrs?.href))}\n\n` : ''
    }
    if (n.type === 'verse') {
      const ref = n.attrs?.reference
      return `${inner.trim()}${typeof ref === 'string' && ref ? ` — ${ref}` : ''}\n\n`
    }
    if (['paragraph', 'heading', 'blockquote', 'codeBlock'].includes(n.type)) return `${inner}\n\n`
    if (['bulletList', 'orderedList', 'taskList'].includes(n.type)) return `${inner}\n`
    if (['listItem', 'taskItem'].includes(n.type)) return `• ${inner.trim()}\n`
    return inner
  }
  return walk(doc.content).replace(/\n{3,}/g, '\n\n').trim()
}

export function isEmptyDoc(doc: TiptapDoc | null | undefined): boolean {
  return tiptapToText(doc).trim() === '' && !JSON.stringify(doc ?? {}).includes('"image')
}

export type EmailEditorChange = 'video' | 'audio' | 'checklist'

// Content for the site email editor, which has no task list or resizable
// image node and keeps a button's words in its `label`: a task list becomes a
// bullet list, a resizable image an image, a button with inline content one
// labelled with its text. `changes` names what will look different in the
// email; videos and audio are kept and sent as links.
export function toEmailEditorContent(nodes: TiptapNode[]): { content: TiptapNode[], changes: EmailEditorChange[] } {
  const changes = new Set<EmailEditorChange>()
  const walk = (n: TiptapNode): TiptapNode[] => {
    const content = n.content?.flatMap(walk)
    switch (n.type) {
      case 'youtube':
        changes.add('video')
        return [n]
      case 'audio':
        changes.add('audio')
        return [n]
      case 'button': {
        const label = String(n.attrs?.label ?? '').trim() || (content ?? []).map(t => t.text ?? '').join('').trim()
        return label ? [{ type: 'button', attrs: { href: n.attrs?.href ?? null, label } }] : []
      }
      case 'taskList':
        changes.add('checklist')
        return [{ type: 'bulletList', content: content ?? [] }]
      case 'taskItem':
        return [{ type: 'listItem', content: content ?? [] }]
      case 'imageResize': {
        const { src, alt, title, width, href } = n.attrs ?? {}
        return [{ type: 'image', attrs: { src, alt, title, ...(width ? { width } : {}), ...(href ? { href } : {}) } }]
      }
      default:
        return [content ? { ...n, content } : n]
    }
  }
  return { content: nodes.flatMap(walk), changes: [...changes] }
}

export function textDoc(text: string): TiptapDoc {
  return {
    type: 'doc',
    content: text.split(/\n{2,}/).map(p => ({ type: 'paragraph', content: p.trim() ? [{ type: 'text', text: p.trim() }] : [] }))
  }
}

// Walks every text node, e.g. to collect strings for AI translation or to
// replace them with translated ones. Scripture (`verse` nodes) is skipped:
// it is never AI-translated.
export function mapText(doc: TiptapDoc, fn: (text: string) => string): TiptapDoc {
  const walk = (n: TiptapNode): TiptapNode => {
    if (n.type === 'verse') return n
    return {
      ...n,
      ...(n.type === 'text' && typeof n.text === 'string' ? { text: fn(n.text) } : {}),
      ...(n.content ? { content: n.content.map(walk) } : {})
    }
  }
  return walk(doc as TiptapNode) as TiptapDoc
}

export function collectText(doc: TiptapDoc): string[] {
  const out: string[] = []
  mapText(doc, (t) => {
    out.push(t)
    return t
  })
  return out
}
