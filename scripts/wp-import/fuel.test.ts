import { afterAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import type { TiptapNode } from '@prayertools/shared/db/schema'
import { tiptapToHtml } from '@prayertools/shared/tiptap'
import { htmlToDoc, mapLink } from './fuel'
import { createImageStore } from './images'

// What the content editor registers (pt-content-extensions.ts on UEditor's starter kit and image).
const NODES = new Set(['doc', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock', 'verse', 'horizontalRule', 'hardBreak', 'image', 'youtube', 'audio', 'button', 'columns', 'column', 'table', 'tableRow', 'tableHeader', 'tableCell', 'text'])
const MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'link', 'superscript', 'subscript', 'textStyle', 'highlight'])

function editorSafe(n: TiptapNode): void {
  expect(NODES.has(n.type)).toBe(true)
  for (const m of n.marks ?? []) expect(MARKS.has(m.type)).toBe(true)
  if (n.type === 'listItem') expect(n.content?.[0]?.type).toBe('paragraph')
  if (n.type === 'columns') expect([2, 3]).toContain(n.content?.length)
  if (['column', 'tableCell', 'tableHeader', 'verse', 'blockquote'].includes(n.type)) expect(n.content?.length).toBeGreaterThan(0)
  n.content?.forEach(editorSafe)
}

function convert(html: string, opts?: Parameters<typeof htmlToDoc>[1]) {
  const out = htmlToDoc(html, opts)
  editorSafe(out.doc as TiptapNode)
  return { content: out.doc.content ?? [], unknown: out.unknown }
}

const text = (t: string, marks?: TiptapNode['marks']): TiptapNode => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t })
const para = (...content: TiptapNode[]): TiptapNode => ({ type: 'paragraph', content })
const link = (href: string) => ({ type: 'link', attrs: { href } })
const color = (c: string) => ({ type: 'textStyle', attrs: { color: c } })

describe('htmlToDoc', () => {
  test('paragraphs, headings and inline marks', () => {
    const { content, unknown } = convert(`
      <!-- wp:heading {"level":1} --><h1 class="wp-block-heading">Day&nbsp;1</h1><!-- /wp:heading -->
      <!-- wp:paragraph --><p>Pray  for <strong>open</strong> <em>doors</em>,<br>  and <a href="https://example.org/a">read more</a>.<sup>[a]</sup></p><!-- /wp:paragraph -->
      <!-- wp:paragraph /-->
      <h3><strong>A prompt written as a heading that runs on well past eighty characters in total length</strong></h3>
      <p><u>Under</u><s>gone</s> <sup>17</sup>For God so loved H<sub>2</sub>O</p>`)
    expect(unknown).toEqual([])
    expect(content).toEqual([
      { type: 'heading', attrs: { level: 2 }, content: [text('Day 1')] },
      para(text('Pray for '), text('open', [{ type: 'bold' }]), text(' '), text('doors', [{ type: 'italic' }]), text(','),
        { type: 'hardBreak' }, text('and '), text('read more', [link('https://example.org/a')]), text('.')),
      para(text('A prompt written as a heading that runs on well past eighty characters in total length', [{ type: 'bold' }])),
      para(text('Under', [{ type: 'underline' }]), text('gone', [{ type: 'strike' }]), text(' '), text('17', [{ type: 'superscript' }]),
        text('For God so loved H'), text('2', [{ type: 'subscript' }]), text('O'))
    ])
  })

  test('text colors and highlights', () => {
    const { content } = convert(`
      <h2 class="wp-block-heading has-vivid-red-color has-text-color">Praise</h2>
      <p>A <span style="color:#0C7986">teal</span> word, <mark style="background-color:#fcb900" class="has-inline-color">amber</mark>,
        <mark style="background-color:rgba(0, 0, 0, 0)" class="has-inline-color has-vivid-purple-color">purple</mark>,
        <mark>marked</mark>, <font color="rgb(59, 110, 43)">green</font>.</p>
      <p><span style="color:#ffffff">white</span> <span style="color:#32373c">default</span> <mark style="background-color:#ffffff">plain</mark></p>
      <p class="has-white-color has-text-color has-background" style="background-color:#063b95">On a box</p>`)
    expect(content).toEqual([
      { type: 'heading', attrs: { level: 2 }, content: [text('Praise', [color('#cf2e2e')])] },
      para(text('A '), text('teal', [color('#0c7986')]), text(' word, '), text('amber', [{ type: 'highlight', attrs: { color: '#fcb900' } }]),
        text(', '), text('purple', [color('#9b51e0')]), text(', '), text('marked', [{ type: 'highlight' }]), text(', '),
        text('green', [color('#3b6e2b')]), text('.')),
      para(text('white default plain')),
      para(text('On a box'))
    ])
  })

  test('lists, separators and spacers', () => {
    const { content } = convert(`
      <ul class="wp-block-list"><li>One<ul><li>One.a</li></ul></li><li>Two</li></ul>
      <hr class="wp-block-separator"/><div style="height:40px" class="wp-block-spacer"></div>
      <ol start="3"><li><img src="https://example.org/x.png" alt="x"></li></ol>`)
    expect(content).toEqual([
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [para(text('One')), { type: 'bulletList', content: [{ type: 'listItem', content: [para(text('One.a'))] }] }] },
          { type: 'listItem', content: [para(text('Two'))] }
        ]
      },
      { type: 'horizontalRule' },
      { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph' }, { type: 'image', attrs: { src: 'https://example.org/x.png', alt: 'x' } }] }] }
    ])
  })

  test('images, linked images, videos and maps', () => {
    const { content, unknown } = convert(`
      <figure class="wp-block-image"><img src="https://demo.prayer.tools/wp-content/uploads/sites/9/2024/01/photo-1024x768.jpg" alt="A street"/><figcaption>Morning prayer walk</figcaption></figure>
      <figure class="wp-block-image size-full"><a href="https://www.google.com/maps/place/Old+Mosque/@1.5,2.5,17z"><img src="https://example.org/map.png" alt="Map"/></a></figure>
      <p>Before <img src="https://example.org/inline.png" alt=""> after</p>
      <figure class="wp-block-embed is-type-video is-provider-youtube"><div class="wp-block-embed__wrapper">
      https://youtu.be/abcdefghijk
      </div></figure>
      <!-- wp:html --><div><iframe src="https://player.vimeo.com/video/123456?badge=0"></iframe></div><!-- /wp:html -->
      <iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3470.5!2d-95.0915!3d29.5581!2m3!1f0!2f0!3f0!3m3!1m2!1s0x0%3A0x0!2sMission+Control!5e0"></iframe>
      <figure class="wp-block-embed is-type-rich is-provider-spotify"><div class="wp-block-embed__wrapper">https://open.spotify.com/track/abc</div></figure>`)
    expect(content).toEqual([
      { type: 'image', attrs: { src: 'https://demo.prayer.tools/wp-content/uploads/sites/9/2024/01/photo-1024x768.jpg', alt: 'A street' } },
      para(text('Morning prayer walk')),
      { type: 'image', attrs: { src: 'https://example.org/map.png', alt: 'Map', href: 'https://www.google.com/maps/place/Old+Mosque/@1.5,2.5,17z' } },
      para(text('Before')),
      { type: 'image', attrs: { src: 'https://example.org/inline.png', alt: '' } },
      para(text('after')),
      { type: 'youtube', attrs: { src: 'https://youtu.be/abcdefghijk' } },
      { type: 'youtube', attrs: { src: 'https://player.vimeo.com/video/123456?badge=0' } },
      para(text('View map', [link('https://www.google.com/maps?q=29.5581,-95.0915')])),
      para(text('abc', [link('https://open.spotify.com/track/abc')]))
    ])
    expect(unknown).toEqual(['embed:spotify'])
    const html = tiptapToHtml({ type: 'doc', content })
    expect(html).toContain('https://www.youtube-nocookie.com/embed/abcdefghijk')
    expect(html).toContain('<a href="https://www.google.com/maps/place/Old+Mosque/@1.5,2.5,17z" target="_blank" rel="noopener"><img src="https://example.org/map.png"')
  })

  test('map links from embed addresses', () => {
    expect(mapLink('https://www.google.com/maps/embed?pb=!1m14!1m8!1m3!1d1000!2d10.5!3d-4.25!3m2!1i1024!2i768')).toBe('https://www.google.com/maps?q=-4.25,10.5')
    expect(mapLink('https://www.google.com/maps/embed?pb=!1m3!2m1!1sx!2sGrand+Bazaar!5e0')).toBe('https://www.google.com/maps?q=Grand%20Bazaar')
    expect(mapLink('https://www.google.com/maps/embed/v1/place?key=k&q=Tunis')).toBe('https://www.google.com/maps?q=Tunis')
    expect(mapLink('https://www.google.com/maps/d/embed?mid=abc123')).toBe('https://www.google.com/maps/d/viewer?mid=abc123')
  })

  test('tables keep their rows, cells and spans', () => {
    const { content, unknown } = convert(`
      <figure class="wp-block-table"><table><thead><tr><th>Category</th><th>Statistic</th></tr></thead>
      <tbody><tr><td><strong>Capital</strong></td><td>Madrid<br>Spain</td></tr><tr><td colspan="2"></td></tr></tbody></table></figure>`)
    expect(unknown).toEqual([])
    expect(content).toEqual([{
      type: 'table',
      content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', content: [para(text('Category'))] }, { type: 'tableHeader', content: [para(text('Statistic'))] }] },
        { type: 'tableRow', content: [{ type: 'tableCell', content: [para(text('Capital', [{ type: 'bold' }]))] }, { type: 'tableCell', content: [para(text('Madrid'), { type: 'hardBreak' }, text('Spain'))] }] },
        { type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 2 }, content: [{ type: 'paragraph' }] }] }
      ]
    }])
  })

  test('columns keep their widths; one column stays as its blocks', () => {
    const { content } = convert(`
      <div class="wp-block-columns"><div class="wp-block-column" style="flex-basis:33.33%"><p>Left</p></div><div class="wp-block-column" style="flex-basis:66.66%"><p>Right</p></div></div>
      <div class="wp-block-columns"><div class="wp-block-column" style="flex-basis:100%"><p>Only</p></div></div>
      <div class="wp-block-columns"><div class="wp-block-column"><p>1</p></div><div class="wp-block-column"><p>2</p></div><div class="wp-block-column"><p>3</p></div><div class="wp-block-column"><p>4</p></div></div>
      <div class="wp-block-genesis-blocks-gb-columns gb-layout-columns-2 gb-2-col-wideleft"><div class="gb-layout-column-wrap">
        <div class="wp-block-genesis-blocks-gb-column gb-block-layout-column"><div class="gb-block-layout-column-inner"><p>Wide</p></div></div>
        <div class="wp-block-genesis-blocks-gb-column gb-block-layout-column"><div class="gb-block-layout-column-inner"><p>“Pray without ceasing.” (1 Thessalonians 5:17)</p></div></div>
      </div></div>`)
    const col = (...c: TiptapNode[]) => ({ type: 'column', content: c })
    expect(content).toEqual([
      { type: 'columns', attrs: { widths: [33.33, 66.66] }, content: [col(para(text('Left'))), col(para(text('Right')))] },
      para(text('Only')),
      { type: 'columns', content: [col(para(text('1'))), col(para(text('2')))] },
      { type: 'columns', content: [col(para(text('3'))), col(para(text('4')))] },
      {
        type: 'columns',
        attrs: { widths: [67, 33] },
        content: [col(para(text('Wide'))), col({ type: 'verse', attrs: { reference: '1 Thessalonians 5:17', translation: null }, content: [para(text('Pray without ceasing.'))] })]
      }
    ])
  })

  test('audio and file blocks', () => {
    const { content, unknown } = convert(`
      <figure class="wp-block-audio"><audio controls src="https://x.prayer.tools/wp-content/uploads/sites/3/2026/02/song.mp3"></audio><figcaption>Rend your hearts</figcaption></figure>
      <audio controls><source src="https://example.org/talk.m4a"></audio>
      <div class="wp-block-file"><object data="https://x.prayer.tools/a.pdf"></object><a href="https://x.prayer.tools/wp-content/uploads/sites/3/2025/02/week-one.pdf">Week one</a><a href="https://x.prayer.tools/a.pdf" class="wp-block-file__button" download>Download</a></div>
      <div class="wp-block-file"><a href="https://x.prayer.tools/wp-content/uploads/sites/3/2025/02/sermon.mp3">Sermon</a></div>
      <!-- wp:genesis-blocks/gb-newsletter {"instanceId":0} /-->`)
    expect(content).toEqual([
      { type: 'audio', attrs: { src: 'https://x.prayer.tools/wp-content/uploads/sites/3/2026/02/song.mp3', title: 'Rend your hearts' } },
      { type: 'audio', attrs: { src: 'https://example.org/talk.m4a', title: null } },
      para(text('Week one', [link('https://x.prayer.tools/wp-content/uploads/sites/3/2025/02/week-one.pdf')])),
      { type: 'audio', attrs: { src: 'https://x.prayer.tools/wp-content/uploads/sites/3/2025/02/sermon.mp3', title: 'Sermon' } }
    ])
    expect(unknown).toEqual(['wp:genesis-blocks/gb-newsletter'])
  })

  test('Scripture becomes verse blocks', () => {
    const { content } = convert(`
      <p><strong>John 3:16 (ESV)</strong></p>
      <p>“For God so loved the world, that he gave his only Son.”</p>
      <p>«Demandez, et l'on vous donnera.» (Luc 11:9)</p>
      <blockquote class="wp-block-quote"><p><em>“The harvest is plentiful, but the laborers are few.”</em></p><cite>– MATTHEW 9:37 ESV</cite></blockquote>
      <p><em>Let all the earth fear the Lord;</em><br><em>let all the inhabitants of the world stand in awe of him!</em> (Psalm 33:8)</p>
      <p>Psalm 46:1 – God is our refuge and strength, a very present help in trouble.</p>
      <p><strong>SCRIPTURE:</strong> “Be still, and know that I am God.” Psalm 46:10</p>`)
    expect(content.map(b => b.type === 'verse' ? b.attrs : b.type)).toEqual([
      { reference: 'John 3:16', translation: 'ESV' },
      { reference: 'Luc 11:9', translation: null },
      { reference: 'MATTHEW 9:37', translation: 'ESV' },
      { reference: 'Psalm 33:8', translation: null },
      { reference: 'Psalm 46:1', translation: null },
      'paragraph',
      { reference: 'Psalm 46:10', translation: null }
    ])
    expect(content[0]!.content).toEqual([para(text('For God so loved the world, that he gave his only Son.'))])
    expect(content[2]!.content).toEqual([para(text('The harvest is plentiful, but the laborers are few.', [{ type: 'italic' }]))])
    expect(content[5]).toEqual(para(text('SCRIPTURE:', [{ type: 'bold' }])))
  })

  test('quotations inside a prayer and Qur’an references stay text', () => {
    const { content } = convert(`
      <p>Pray that they would know that “God so loved the world” (John 3:16) and turn to him.</p>
      <p><em>“Ramadan is the month in which the Quran was revealed.”</em> (Al-Baqarah 2:185)</p>`)
    expect(content.map(b => b.type)).toEqual(['paragraph', 'paragraph'])
  })

  test('location tokens become placeholders', () => {
    const { content } = convert('<p>Pray for the church [in location] and for [people_group]. Oren [en el lugar].</p>')
    expect(content).toEqual([para(text('Pray for the church {in_place} and for {people_group}. Oren {in_place}.'))])
  })

  test('reusable blocks expand from their wp_block post', () => {
    const blocks: Record<number, string> = { 7: '<!-- wp:paragraph --><p>Shared closing prayer.</p><!-- /wp:paragraph --><!-- wp:block {"ref":7} /-->' }
    const { content, unknown } = convert('<p>Intro</p><!-- wp:block {"ref":7} /--><!-- wp:block {"ref":8} /-->', { reusableBlock: ref => blocks[ref] })
    expect(content).toEqual([para(text('Intro')), para(text('Shared closing prayer.'))])
    expect(unknown).toEqual(['wp:block'])
  })
})

describe('createImageStore', () => {
  const dirs: string[] = []
  afterAll(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true })
  })

  test('copies images, audio and linked files of the network and leaves other addresses', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wp-import-'))
    dirs.push(root)
    const month = join(root, 'uploads', '3', '2025', '02')
    await mkdir(month, { recursive: true })
    await writeFile(join(month, 'photo.png'), await sharp({ create: { width: 40, height: 30, channels: 3, background: '#336699' } }).png().toBuffer())
    await writeFile(join(month, 'song.MP3'), 'ID3 fake audio')
    await writeFile(join(month, 'week-one.pdf'), '%PDF-1.4 fake')
    const store = createImageStore({ uploadsDir: join(root, 'uploads'), outDir: join(root, 'out'), baseUrl: 'http://localhost:3040', hosts: ['ramadan.example.org'] })
    const up = (host: string, file: string) => `https://${host}/wp-content/uploads/sites/3/2025/02/${file}`
    const doc = await store.rewrite({
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: up('demo.prayer.tools', 'photo-300x200.png'), alt: '', href: up('demo.prayer.tools', 'week-one.pdf') } },
        { type: 'image', attrs: { src: up('ramadan.example.org', 'photo.png'), alt: '', href: 'https://www.google.com/maps?q=1,2' } },
        { type: 'audio', attrs: { src: up('demo.pray4movement.org', 'song.MP3'), title: null } },
        para(text('Week one', [link(up('demo.prayer.tools', 'week-one.pdf'))]), text(' and '), text('day 2', [link('https://demo.prayer.tools/fuel/2')])),
        { type: 'image', attrs: { src: up('demo.prayer.tools', 'gone.png'), alt: '' } },
        { type: 'image', attrs: { src: 'https://example.org/elsewhere.png', alt: '' } }
      ]
    })
    // The missing image is removed, so nothing points at the old server.
    expect(doc.content!.some(n => n.attrs?.src === up('demo.prayer.tools', 'gone.png'))).toBe(false)
    const [img, img2, aud, p, other] = doc.content!
    expect(img!.attrs!.src).toMatch(/^http:\/\/localhost:3040\/uploads\/[0-9a-f]{32}\.webp$/)
    expect(img2!.attrs!.src).toBe(img!.attrs!.src)
    expect(img!.attrs!.href).toMatch(/^http:\/\/localhost:3040\/uploads\/[0-9a-f]{32}\.pdf$/)
    expect(img2!.attrs!.href).toBe('https://www.google.com/maps?q=1,2')
    expect(aud!.attrs!.src).toMatch(/^http:\/\/localhost:3040\/uploads\/[0-9a-f]{32}\.mp3$/)
    expect(p!.content![0]!.marks![0]!.attrs!.href).toBe(img!.attrs!.href)
    expect(p!.content![2]!.marks![0]!.attrs!.href).toBe('https://demo.prayer.tools/fuel/2')
    expect(other!.attrs!.src).toBe('https://example.org/elsewhere.png')
    expect(await store.rewriteUrl(up('demo.prayer.tools', 'photo.png'))).toBe(img!.attrs!.src as string)
    expect(store.report.kinds).toEqual({ image: { copied: 1, written: 1, missing: 1 }, audio: { copied: 1, written: 1, missing: 0 }, file: { copied: 1, written: 1, missing: 0 } })
    expect(store.report.extensions).toEqual({ png: 1, mp3: 1, pdf: 1 })
    expect(await store.rewriteUrl(up('demo.prayer.tools', 'gone.png'))).toBeNull()
    expect(await store.rewriteUrl('https://example.org/elsewhere.png')).toBe('https://example.org/elsewhere.png')
    expect(store.report.external).toBe(1)
    expect((await readdir(join(root, 'out'))).map(f => f.split('.').pop()).sort()).toEqual(['mp3', 'pdf', 'webp'])
  })
  test('uses a re-uploaded copy or the first upload when the named file is gone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wp-import-'))
    dirs.push(root)
    const month = join(root, 'uploads', '7', '2024', '03')
    await mkdir(month, { recursive: true })
    const png = (color: string) => sharp({ create: { width: 20, height: 20, channels: 3, background: color } }).png().toBuffer()
    await writeFile(join(month, 'cross-1.png'), await png('#aa0000'))
    await writeFile(join(month, 'well.png'), await png('#00aa00'))
    const store = createImageStore({ uploadsDir: join(root, 'uploads'), outDir: join(root, 'out'), baseUrl: 'http://localhost:3040' })
    const up = (file: string) => `https://demo.prayer.tools/wp-content/uploads/sites/7/2024/03/${file}`
    expect(await store.rewriteUrl(up('cross.png'))).toMatch(/\/uploads\/[0-9a-f]{32}\.webp$/)
    expect(await store.rewriteUrl(up('well-2-768x1024.png'))).toMatch(/\/uploads\/[0-9a-f]{32}\.webp$/)
    expect(store.report.substituted.map(x => x.file)).toEqual(['7/2024/03/cross-1.png', '7/2024/03/well.png'])
    expect(store.report.missing).toEqual([])
  })
})
