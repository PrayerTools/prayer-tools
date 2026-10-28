import { describe, expect, it } from 'vitest'
import { collectText, escapeHtml, fillVars, isEmptyDoc, mapText, textDoc, tiptapToHtml, tiptapToText } from '../src/tiptap'
import type { TiptapDoc } from '../src/db/schema'

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
    expect(tiptapToText(doc, { place: 'Beirut' })).toBe('Pray for Beirut\n\nBold and a link\n\nFor God so loved the world — John 3:16\n\n• Families')
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
