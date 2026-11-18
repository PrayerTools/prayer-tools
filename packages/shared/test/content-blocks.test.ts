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

describe('tables, audio, linked images and columns', () => {
  const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
  const cell = (type: string, text: string) => ({ type, attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p(text)] })
  const doc: TiptapDoc = { type: 'doc', content: [
    { type: 'table', content: [
      { type: 'tableRow', content: [cell('tableHeader', 'Day'), cell('tableHeader', 'Focus')] },
      { type: 'tableRow', content: [cell('tableCell', '1'), cell('tableCell', '**Families**')] }
    ] },
    { type: 'audio', attrs: { src: 'https://cdn.example.org/pray.mp3', title: 'Morning prayer' } },
    { type: 'image', attrs: { src: 'https://cdn.example.org/map.webp', alt: 'Map of Rabat', title: null, href: 'https://maps.google.com/?q=Rabat' } },
    { type: 'columns', attrs: { widths: [33, 67] }, content: [
      { type: 'column', content: [{ type: 'image', attrs: { src: 'https://cdn.example.org/map.webp', alt: 'Map', title: null, href: null } }] },
      { type: 'column', content: [{ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Rabat' }] }, p('Pray for the city')] }
    ] }
  ] }

  it('reads them into blocks that write back exactly', () => {
    const { blocks, exact } = docToBlocks(doc)
    expect(blocks).toEqual([
      { type: 'table', header: true, rows: [['Day', 'Focus'], ['1', '\\*\\*Families\\*\\*']] },
      { type: 'audio', src: 'https://cdn.example.org/pray.mp3', title: 'Morning prayer' },
      { type: 'image', src: 'https://cdn.example.org/map.webp', alt: 'Map of Rabat', href: 'https://maps.google.com/?q=Rabat' },
      { type: 'columns', widths: [33, 67], columns: [
        [{ type: 'image', src: 'https://cdn.example.org/map.webp', alt: 'Map' }],
        [{ type: 'heading', level: 3, text: 'Rabat' }, { type: 'paragraph', text: 'Pray for the city' }]
      ] }
    ])
    expect(exact).toBe(true)
    expect(tiptapToHtml(blocksToDoc(blocks))).toBe(tiptapToHtml(doc))
  })

  it('pads short table rows and leaves empty columns a paragraph', () => {
    const out = blocksToDoc([
      { type: 'table', rows: [['a', 'b'], ['c']] },
      { type: 'columns', columns: [[{ type: 'paragraph', text: 'x' }], []] }
    ])
    expect(out.content![0]!.content![1]!.content).toEqual([
      { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'c' }] }] },
      { type: 'tableCell', content: [{ type: 'paragraph' }] }
    ])
    expect(out.content![1]!.content![1]).toEqual({ type: 'column', content: [{ type: 'paragraph' }] })
  })

  it('flags merged cells and nested columns as inexact, reading nested columns as their blocks', () => {
    const merged: TiptapDoc = { type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [{ ...cell('tableCell', 'wide'), attrs: { colspan: 2 } }] }] }] }
    expect(docToBlocks(merged).exact).toBe(false)
    const nested: TiptapDoc = { type: 'doc', content: [{ type: 'columns', content: [
      { type: 'column', content: [{ type: 'columns', content: [{ type: 'column', content: [p('a')] }, { type: 'column', content: [p('b')] }] }] },
      { type: 'column', content: [p('c')] }
    ] }] }
    const read = docToBlocks(nested)
    expect(read.exact).toBe(false)
    expect(read.blocks).toEqual([{ type: 'columns', columns: [[{ type: 'paragraph', text: 'a' }, { type: 'paragraph', text: 'b' }], [{ type: 'paragraph', text: 'c' }]] }])
  })

  it('rejects columns that are nested, too few or badly sized, and audio without a web src', () => {
    const col = [{ type: 'paragraph', text: 'x' }] as ContentBlock[]
    expect(() => blocksToDoc([{ type: 'columns', columns: [col] }])).toThrow(/blocks\[0\]: columns needs 2 or 3 columns/)
    expect(() => blocksToDoc([{ type: 'columns', columns: [col, col], widths: [100] }])).toThrow(/widths needs a positive number/)
    expect(() => blocksToDoc([{ type: 'columns', columns: [[{ type: 'columns', columns: [col, col] }], col] }])).toThrow(/blocks\[0\]\.columns\[0\]\[0\]: columns can't hold more columns/)
    expect(() => blocksToDoc([{ type: 'audio', src: 'javascript:alert(1)' }])).toThrow(/audio needs/)
    expect(() => blocksToDoc([{ type: 'image', src: 'https://x.org/a.png', alt: 'a', href: 'javascript:alert(1)' }])).toThrow(/href/)
  })
})
