import { describe, expect, it } from 'vitest'
import { blocksToDoc, ContentBlocksError, docToBlocks, parseInline, serializeInline, type ContentBlock } from '../src/content-blocks'
import { tiptapToHtml } from '../src/tiptap'
import type { TiptapDoc } from '../src/db/schema'

const editorDoc: TiptapDoc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2, textAlign: null }, content: [{ type: 'text', text: 'Pray for {place}' }] },
    { type: 'paragraph', attrs: { textAlign: 'center' }, content: [
      { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' and ' },
      { type: 'text', text: 'both', marks: [{ type: 'bold' }, { type: 'italic' }] },
      { type: 'text', text: ', ' },
      { type: 'text', text: 'a link', marks: [{ type: 'link', attrs: { href: 'https://example.org/?a=1', target: '_blank', rel: 'noopener', class: null } }] },
      { type: 'hardBreak' },
      { type: 'text', text: '2 * 3 [sic]' }
    ] },
    { type: 'verse', attrs: { reference: 'John 3:16', translation: 'NIV' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'For God so loved the world' }] }] },
    { type: 'bulletList', content: [
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Families' }] }] },
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Leaders', marks: [{ type: 'strike' }] }] }] }
    ] },
    { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Two' }] }] },
    { type: 'image', attrs: { src: 'https://cdn.example.org/a.webp', alt: 'A market', title: null } },
    { type: 'youtube', attrs: { src: 'https://www.youtube.com/embed/dQw4w9WgXcQ', width: 640 } },
    { type: 'button', attrs: { href: 'https://example.org/give', label: 'Give' } },
    { type: 'horizontalRule' },
    { type: 'paragraph' }
  ]
}

describe('docToBlocks', () => {
  it('reads editor content into blocks that write back exactly', () => {
    const { blocks, exact } = docToBlocks(editorDoc)
    expect(exact).toBe(true)
    expect(blocks[0]).toEqual({ type: 'heading', level: 2, text: 'Pray for {place}' })
    expect(blocks[1]).toEqual({ type: 'paragraph', align: 'center', text: '**Bold** and ***both***, [a link](https://example.org/?a=1)\n2 \\* 3 \\[sic\\]' })
    expect(blocks[2]).toEqual({ type: 'verse', reference: 'John 3:16', translation: 'NIV', text: 'For God so loved the world' })
    expect(blocks[3]).toEqual({ type: 'list', items: ['Families', '~~Leaders~~'] })
    expect(blocks[4]).toEqual({ type: 'quote', text: 'One\n\nTwo' })
    expect(tiptapToHtml(blocksToDoc(blocks))).toBe(tiptapToHtml(editorDoc))
  })

  it('flags content blocks cannot express', () => {
    const colored: TiptapDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Red', marks: [{ type: 'textStyle', attrs: { color: '#f00' } }] }] }] }
    expect(docToBlocks(colored)).toEqual({ blocks: [{ type: 'paragraph', text: 'Red' }], exact: false })
    const nested: TiptapDoc = { type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Outer' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Inner' }] }] }] }
    ] }] }] }
    expect(docToBlocks(nested).exact).toBe(false)
  })

  it('reads an empty doc as no blocks', () => {
    expect(docToBlocks(null)).toEqual({ blocks: [], exact: true })
  })
})

describe('blocksToDoc', () => {
  it('splits paragraphs on blank lines and keeps single newlines as breaks', () => {
    const doc = blocksToDoc([{ type: 'paragraph', text: 'First\nline\n\nSecond' }])
    expect(doc.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'First' }, { type: 'hardBreak' }, { type: 'text', text: 'line' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }
    ])
  })

  it('rejects incomplete blocks with the failing block named', () => {
    expect(() => blocksToDoc([{ type: 'paragraph', text: 'ok' }, { type: 'verse', reference: '', text: 'x' }])).toThrow(/blocks\[1\]: a verse needs its reference/)
    expect(() => blocksToDoc([{ type: 'image', src: 'https://x.org/a.png', alt: ' ' }])).toThrow(ContentBlocksError)
    expect(() => blocksToDoc([{ type: 'nope' } as unknown as ContentBlock])).toThrow(/unknown block type/)
  })
})

describe('inline markup', () => {
  it('leaves unmatched markers as text', () => {
    expect(parseInline('5 * 3 = 15')).toEqual([{ type: 'text', text: '5 * 3 = 15' }])
    expect(parseInline('see [notes]')).toEqual([{ type: 'text', text: 'see [notes]' }])
  })

  it('keeps code literal', () => {
    const nodes = parseInline('run `a*b*c` now')
    expect(nodes[1]).toEqual({ type: 'text', text: 'a*b*c', marks: [{ type: 'code' }] })
    expect(serializeInline(nodes)).toBe('run `a*b*c` now')
  })

  it('round-trips marks inside links', () => {
    const text = 'Read [the **full** story](https://example.org) today'
    expect(serializeInline(parseInline(text))).toBe(text)
  })
})
