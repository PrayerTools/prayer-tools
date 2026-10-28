// One Tiptap renderer for prayer content, landing sections and email. Covers
// every node the editor offers, including Scripture verses. `web` output uses
// classes styled by the public site; `email` output uses inline styles.
import type { TiptapDoc, TiptapNode } from './db/schema'
import { videoEmbed } from './video'

export type RenderMode = 'web' | 'email'

export interface RenderOptions {
  mode?: RenderMode
  // Placeholder values: `{site_name}` in text becomes vars.site_name.
  vars?: Record<string, string>
  // Brand color for links and buttons in email.
  color?: string
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

function safeColor(color: unknown): string | null {
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
  img: 'max-width:100%;height:auto;margin:16px 0;border-radius:6px;'
}

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

export function renderNode(n: TiptapNode, o: RenderOptions): string {
  const email = o.mode === 'email'
  const inner = () => renderNodes(n.content, o)
  switch (n.type) {
    case 'doc':
      return inner()
    case 'paragraph': {
      const style = (email ? EMAIL.p : '') + align(n)
      return `<p${style ? ` style="${style}"` : ''}>${inner() || (email ? '&nbsp;' : '')}</p>`
    }
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
      return `<img src="${src}" alt="${alt}"${width}${email ? ` style="${EMAIL.img}"` : ' loading="lazy"'} />`
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
      case 'highlight': text = `<mark>${text}</mark>`; break
      case 'link': {
        const href = safeUrl(mark.attrs?.href)
        const style = o.mode === 'email' ? ` style="color:${safeColor(o.color) ?? '#18181b'};text-decoration:underline;"` : ''
        text = `<a href="${href}"${style} rel="noopener">${text}</a>`
        break
      }
      case 'textStyle': {
        const c = safeColor(mark.attrs?.color)
        if (c) text = `<span style="color:${c};">${text}</span>`
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

export function tiptapToText(doc: TiptapDoc | null | undefined, vars?: Record<string, string>): string {
  if (!doc || !Array.isArray(doc.content)) return ''
  const walk = (nodes: TiptapNode[] | undefined): string => (nodes ?? []).map((n) => {
    if (n.type === 'text') return fillVars(n.text ?? '', vars)
    if (n.type === 'hardBreak') return '\n'
    const inner = walk(n.content)
    if (n.type === 'verse') {
      const ref = n.attrs?.reference
      return `${inner.trim()}${typeof ref === 'string' && ref ? ` — ${ref}` : ''}\n\n`
    }
    if (['paragraph', 'heading', 'blockquote', 'codeBlock'].includes(n.type)) return `${inner}\n\n`
    if (['listItem', 'taskItem'].includes(n.type)) return `• ${inner.trim()}\n`
    return inner
  }).join('')
  return walk(doc.content).replace(/\n{3,}/g, '\n\n').trim()
}

export function isEmptyDoc(doc: TiptapDoc | null | undefined): boolean {
  return tiptapToText(doc).trim() === '' && !JSON.stringify(doc ?? {}).includes('"image')
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
