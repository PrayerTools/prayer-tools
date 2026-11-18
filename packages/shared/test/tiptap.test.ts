import { describe, expect, it } from 'vitest'
import { collectText, escapeHtml, fillVars, isEmptyDoc, mapText, textDoc, tiptapToHtml, tiptapToText, toEmailEditorContent } from '../src/tiptap'
import type { TiptapDoc, TiptapNode } from '../src/db/schema'

const doc: TiptapDoc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Pray for {place}' }] },
    { type: 'paragraph', attrs: { textAlign: 'center' }, content: [
      { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' and ' },
      { type: 'text', text: 'a link', marks: [{ type: 'link', attrs: { href: 'https://example.org/?a=1&b=2' } }] }
    ] },
    { type: 'verse', attrs: { reference: 'John 3:16', translation: 'NIV' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'For God so loved the world' }] }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Families' }] }] }] }
  ]
}

describe('tiptapToHtml', () => {
  it('renders nodes and marks for the web', () => {
    const html = tiptapToHtml(doc, { vars: { place: 'Damascus' } })
    expect(html).toContain('<h2>Pray for Damascus</h2>')
    expect(html).toContain('<p style="text-align:center;"><strong>Bold</strong> and <a href="https://example.org/?a=1&amp;b=2" rel="noopener">a link</a></p>')
    expect(html).toContain('<blockquote class="verse"><p>For God so loved the world</p><cite class="verse-ref">John 3:16 (NIV)</cite></blockquote>')
    expect(html).toContain('<ul><li><p>Families</p></li></ul>')
  })

  it('embeds only YouTube and Vimeo players', () => {
    const video = (src: string) => tiptapToHtml({ type: 'doc', content: [{ type: 'youtube', attrs: { src } }] })
    expect(video('https://www.youtube.com/embed/dQw4w9WgXcQ')).toContain('<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"')
    expect(video('https://evil.example/page')).toBe('')
  })

  it('inlines styles for email', () => {
    const html = tiptapToHtml(doc, { mode: 'email', color: '#2f6f5e' })
    expect(html).toMatch(/<h2 style="margin:24px 0 12px;[^"]*font-size:22px;">/)
    expect(html).toContain('style="color:#2f6f5e;text-decoration:underline;"')
    expect(html).toMatch(/<blockquote class="verse" style="[^"]+">/)
  })

  it('neutralises unsafe links, images and text', () => {
    const bad: TiptapDoc = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: '<script>x</script>', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] },
      { type: 'image', attrs: { src: 'data:text/html,hi', alt: '"quoted"' } },
      { type: 'heading', attrs: { level: 9 }, content: [{ type: 'text', text: 'h' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'c', marks: [{ type: 'textStyle', attrs: { color: 'red;background:url(x)' } }] }] }
    ] }
    const html = tiptapToHtml(bad)
    expect(html).toContain('<a href="#" rel="noopener">&lt;script&gt;x&lt;/script&gt;</a>')
    expect(html).toContain('<img src="#" alt="&quot;quoted&quot;" loading="lazy" />')
    expect(html).toContain('<h2>h</h2>')
    expect(html).toContain('<p>c</p>')
    expect(tiptapToHtml(null)).toBe('')
  })
})

describe('text helpers', () => {
  it('plain text keeps structure and verse references', () => {
    expect(tiptapToText(doc, { place: 'Beirut' })).toBe('Pray for Beirut\n\nBold and a link (https://example.org/?a=1&b=2)\n\nFor God so loved the world — John 3:16\n\n• Families')
  })

  it('plain text shows image alt text, video links and button links', () => {
    const d: TiptapDoc = { type: 'doc', content: [
      { type: 'image', attrs: { src: 'https://x/y.png', alt: 'Families praying' } },
      { type: 'image', attrs: { src: 'https://x/z.png' } },
      { type: 'youtube', attrs: { src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } },
      { type: 'button', attrs: { href: 'https://example.org/join', label: 'Join {site_name}' } }
    ] }
    expect(tiptapToText(d, { site_name: 'Pray Morocco' })).toBe('[Families praying]\n\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\n\nJoin Pray Morocco (https://example.org/join)')
  })

  it('plain text leaves a blank line after a list', () => {
    const list = { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }] }] }
    expect(tiptapToText({ type: 'doc', content: [list, { type: 'paragraph', content: [{ type: 'text', text: 'After' }] }] })).toBe('• One\n\nAfter')
  })

  it('plain text writes a link as its words and address, once', () => {
    const link = (text: string, href: string, marks: { type: string }[] = []) => ({ type: 'text', text, marks: [...marks, { type: 'link', attrs: { href } }] })
    const d: TiptapDoc = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Read ' }, link('our ', 'https://example.org/news'), link('news', 'https://example.org/news', [{ type: 'bold' }]), { type: 'text', text: ' today.' }] },
      { type: 'paragraph', content: [link('example.org', 'https://www.example.org/'), { type: 'text', text: ' and ' }, link('https://example.org/a', 'https://example.org/a')] },
      { type: 'paragraph', content: [link('Write to us', 'mailto:hello@example.org'), { type: 'text', text: ' or ' }, link('hello@example.org', 'mailto:hello@example.org')] },
      { type: 'paragraph', content: [link('{site_link}', 'https://pray.example.org'), { type: 'text', text: ' · ' }, link('Visit {site_name}', 'https://pray.example.org')] },
      { type: 'paragraph', content: [link('top', '#top'), { type: 'text', text: ' ' }, link('bad', 'javascript:alert(1)'), { type: 'text', text: ' ' }, link('one', 'https://a.example'), link('two', 'https://b.example')] }
    ] }
    expect(tiptapToText(d, { site_link: 'https://pray.example.org', site_name: 'Pray Morocco' })).toBe([
      'Read our news (https://example.org/news) today.',
      'example.org and https://example.org/a',
      'Write to us (hello@example.org) or hello@example.org',
      'https://pray.example.org · Visit Pray Morocco (https://pray.example.org)',
      'top bad one (https://a.example)two (https://b.example)'
    ].join('\n\n'))
  })

  it('textDoc splits paragraphs; isEmptyDoc', () => {
    const d = textDoc('One\n\nTwo')
    expect(d.content).toHaveLength(2)
    expect(tiptapToText(d)).toBe('One\n\nTwo')
    expect(isEmptyDoc(textDoc('   '))).toBe(true)
    expect(isEmptyDoc({ type: 'doc', content: [{ type: 'image', attrs: { src: 'https://x/y.png' } }] })).toBe(false)
    expect(isEmptyDoc(d)).toBe(false)
  })

  it('mapText and collectText skip Scripture', () => {
    expect(collectText(doc)).toEqual(['Pray for {place}', 'Bold', ' and ', 'a link', 'Families'])
    const upper = mapText(doc, t => t.toUpperCase())
    expect(tiptapToText(upper)).toContain('For God so loved the world')
    expect(tiptapToText(upper)).toContain('FAMILIES')
    expect(tiptapToText(doc)).toContain('Families')
  })

  it('fillVars leaves unknown placeholders; escapeHtml escapes quotes', () => {
    expect(fillVars('{a} {b}', { a: 'x' })).toBe('x {b}')
    expect(escapeHtml(`<a href="x">'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#039;&lt;/a&gt;')
  })
})

describe('toEmailEditorContent', () => {
  it('keeps nodes the email editor shows and notes videos', () => {
    const nodes = [
      ...doc.content!,
      { type: 'youtube', attrs: { src: 'https://vimeo.com/76979871' } }
    ]
    expect(toEmailEditorContent(nodes)).toEqual({ content: nodes, changes: ['video'] })
  })

  it('keeps buttons, turns task lists into bullet lists and resizable images into images', () => {
    const { content, changes } = toEmailEditorContent([
      { type: 'button', attrs: { href: 'https://example.org/join', label: 'Join' } },
      { type: 'button', attrs: { href: 'https://example.org/give' }, content: [{ type: 'text', text: 'Give' }] },
      { type: 'button', attrs: { href: '', label: '' } },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pray' }] }] }] },
      { type: 'imageResize', attrs: { src: 'https://x/y.png', alt: 'A city', width: 320, containerStyle: 'x' } }
    ])
    expect(content).toEqual([
      { type: 'button', attrs: { href: 'https://example.org/join', label: 'Join' } },
      { type: 'button', attrs: { href: 'https://example.org/give', label: 'Give' } },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pray' }] }] }] },
      { type: 'image', attrs: { src: 'https://x/y.png', alt: 'A city', title: undefined, width: 320 } }
    ])
    expect(changes).toEqual(['checklist'])
  })
})

describe('tables, audio, linked images and columns', () => {
  const p = (text: string): TiptapNode => ({ type: 'paragraph', content: [{ type: 'text', text }] })
  const table: TiptapNode = { type: 'table', content: [
    { type: 'tableRow', content: [
      { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p('Day')] },
      { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: [120] }, content: [p('Focus')] }
    ] },
    { type: 'tableRow', content: [
      { type: 'tableCell', attrs: { colspan: 2, rowspan: 1, colwidth: null }, content: [p('Families'), p('Leaders')] }
    ] }
  ] }
  const audio = (attrs: Record<string, unknown>): TiptapDoc => ({ type: 'doc', content: [{ type: 'audio', attrs }] })
  const image = (href: unknown): TiptapDoc => ({ type: 'doc', content: [{ type: 'image', attrs: { src: 'https://cdn.example.org/map.webp', alt: 'Map of Rabat', href } }] })
  const columns = (widths: unknown): TiptapDoc => ({ type: 'doc', content: [{ type: 'columns', attrs: { widths }, content: [
    { type: 'column', content: [{ type: 'image', attrs: { src: 'https://cdn.example.org/map.webp', alt: 'Map' } }] },
    { type: 'column', content: [p('Pray for Rabat')] }
  ] }] })

  it('renders a table for the web in a scrolling wrapper', () => {
    expect(tiptapToHtml({ type: 'doc', content: [table] })).toBe(
      '<div class="table-scroll"><table><tbody><tr><th><p>Day</p></th><th><p>Focus</p></th></tr><tr><td colspan="2"><p>Families</p><p>Leaders</p></td></tr></tbody></table></div>'
    )
  })

  it('renders a table for email with inline styles and tight cell paragraphs', () => {
    const html = tiptapToHtml({ type: 'doc', content: [table] }, { mode: 'email' })
    expect(html).toMatch(/^<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;[^"]*"><tbody><tr><th style="[^"]*background:#f4f4f5;[^"]*"><p style="margin:0;">Day<\/p><\/th>/)
    expect(html).toMatch(/<td colspan="2" style="border:1px solid #d4d4d8;[^"]*"><p style="margin:0 0 8px;">Families<\/p><p style="margin:0;">Leaders<\/p><\/td>/)
  })

  it('renders audio as a player on the web and as a Listen link in email', () => {
    const titled = audio({ src: 'https://cdn.example.org/pray.mp3', title: 'Morning prayer' })
    expect(tiptapToHtml(titled)).toBe('<figure class="audio"><figcaption>Morning prayer</figcaption><audio controls preload="none" src="https://cdn.example.org/pray.mp3" aria-label="Morning prayer"></audio></figure>')
    expect(tiptapToHtml(titled, { mode: 'email', lang: 'es', color: '#2f6f5e' })).toBe(
      '<p style="margin:0 0 16px;font-size:16px;line-height:1.6;"><a href="https://cdn.example.org/pray.mp3" style="color:#2f6f5e;text-decoration:underline;font-weight:600;">▶ Escuchar: Morning prayer</a></p>'
    )
    expect(tiptapToHtml(audio({ src: '/uploads/a.ogg', title: null }), { mode: 'email' })).toContain('>▶ Listen</a>')
    expect(tiptapToHtml(audio({ src: '/uploads/a.ogg', title: null }))).toBe('<figure class="audio"><audio controls preload="none" src="/uploads/a.ogg"></audio></figure>')
    expect(tiptapToHtml(audio({ src: 'javascript:alert(1)' }))).toBe('')
    expect(tiptapToHtml(audio({ src: '//evil.example/a.mp3' }))).toBe('')
  })

  it('wraps a linked image in its link, in web and email', () => {
    expect(tiptapToHtml(image('https://maps.google.com/?q=Rabat&z=5'))).toBe(
      '<a href="https://maps.google.com/?q=Rabat&amp;z=5" target="_blank" rel="noopener"><img src="https://cdn.example.org/map.webp" alt="Map of Rabat" loading="lazy" /></a>'
    )
    expect(tiptapToHtml(image('https://maps.google.com/'), { mode: 'email' })).toMatch(/^<a href="https:\/\/maps.google.com\/" target="_blank" rel="noopener"><img [^>]*style="max-width:100%;[^"]*" \/><\/a>$/)
    expect(tiptapToHtml(image('javascript:alert(1)'))).toBe('<img src="https://cdn.example.org/map.webp" alt="Map of Rabat" loading="lazy" />')
    expect(tiptapToHtml(image(null))).toBe('<img src="https://cdn.example.org/map.webp" alt="Map of Rabat" loading="lazy" />')
  })

  it('renders columns as a grid at their shares on the web', () => {
    expect(tiptapToHtml(columns([33, 67]))).toBe(
      '<div class="columns" style="--pt-columns:33fr 67fr;"><div class="column"><img src="https://cdn.example.org/map.webp" alt="Map" loading="lazy" /></div><div class="column"><p>Pray for Rabat</p></div></div>'
    )
    expect(tiptapToHtml(columns(null))).toContain('style="--pt-columns:1fr 1fr;"')
    expect(tiptapToHtml(columns([1, 2, 3]))).toContain('style="--pt-columns:1fr 1fr;"')
    expect(tiptapToHtml(columns(['50%', 50]))).toContain('style="--pt-columns:1fr 1fr;"')
  })

  it('renders email columns as inline blocks that stack when the email is narrow', () => {
    const html = tiptapToHtml(columns([33, 67]), { mode: 'email' })
    expect(html).toMatch(/^<div><div style="display:inline-block;vertical-align:top;width:100%;[^"]*max-width:174px;margin-right:16px;"><img /)
    expect(html).toContain('max-width:353px;"><p style="margin:0 0 16px;')
    expect(tiptapToHtml(columns(null), { mode: 'email', lang: 'ar' })).toContain('max-width:264px;margin-left:16px;')
  })

  it('renders highlight colors and super- and subscript in email', () => {
    const marked: TiptapDoc = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: '16', marks: [{ type: 'superscript' }] },
      { type: 'text', text: 'H' },
      { type: 'text', text: '2', marks: [{ type: 'subscript' }] },
      { type: 'text', text: 'O', marks: [{ type: 'highlight', attrs: { color: '#fde68a' } }] },
      { type: 'text', text: '!', marks: [{ type: 'highlight' }] }
    ] }] }
    expect(tiptapToHtml(marked, { mode: 'email' })).toContain('<sup>16</sup>H<sub>2</sub><span style="background-color:#fde68a;">O</span><span style="background-color:#fef08a;">!</span>')
  })

  it('renders text and highlight colors as CSS variables on the web and inline in email', () => {
    const colored: TiptapDoc = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'red', marks: [{ type: 'textStyle', attrs: { color: '#cf2e2e' } }] },
      { type: 'text', text: 'marked', marks: [{ type: 'highlight', attrs: { color: 'rgb(255, 217, 102)' } }] },
      { type: 'text', text: 'plain', marks: [{ type: 'highlight' }] },
      { type: 'text', text: 'bad', marks: [{ type: 'highlight', attrs: { color: 'var(--x)' } }] }
    ] }] }
    expect(tiptapToHtml(colored)).toBe('<p><span class="pt-color" style="--pt-color:#cf2e2e;">red</span><mark class="pt-mark" style="--pt-mark:rgb(255, 217, 102);">marked</mark><mark>plain</mark><mark>bad</mark></p>')
    expect(tiptapToHtml(colored, { mode: 'email' })).toContain('<span style="color:#cf2e2e;">red</span><span style="background-color:rgb(255, 217, 102);">marked</span>')
  })

  it('writes plain text for tables, audio, linked images and columns', () => {
    const d: TiptapDoc = { type: 'doc', content: [
      table,
      ...audio({ src: 'https://cdn.example.org/pray.mp3', title: 'Morning prayer' }).content!,
      ...audio({ src: 'https://cdn.example.org/b.mp3' }).content!,
      ...image('https://maps.google.com/').content!,
      ...columns(null).content!
    ] }
    expect(tiptapToText(d)).toBe([
      'Day | Focus\nFamilies Leaders',
      'Morning prayer (https://cdn.example.org/pray.mp3)',
      'https://cdn.example.org/b.mp3',
      '[Map of Rabat] (https://maps.google.com/)',
      '[Map]',
      'Pray for Rabat'
    ].join('\n\n'))
  })

  it('keeps audio, tables and columns for the email editor and notes audio', () => {
    const nodes = [table, ...audio({ src: 'https://cdn.example.org/pray.mp3' }).content!, ...columns([33, 67]).content!]
    expect(toEmailEditorContent(nodes)).toEqual({ content: nodes, changes: ['audio'] })
  })
})
