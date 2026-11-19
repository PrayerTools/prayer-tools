// Copies the images and files WordPress content points at into prayer.tools
// storage. Images are stored like the admin's library images
// (`ptStoreLibraryImage`) and scripts/import-library.ts: one WebP of up to
// 1600 px named by a hash of the source. Audio and other files (PDFs and the
// like) are stored as they are, named by a hash of their bytes with their
// extension. Everything goes to S3 when it is configured and to
// apps/admin/.data/uploads otherwise. Only this network's files are copied
// (prayer.tools and pray4movement.org hosts plus `hosts`, under
// /wp-content/uploads/sites/<N>/, and /wp-content/plugins/ when `pluginsDir`
// is given), read from the extracted backup; every other URL is left as it is.
import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { S3Client } from '@bradenmacdonald/s3-lite-client'
import type { TiptapDoc, TiptapNode } from '@prayertools/shared/db/schema'

export interface ImageStoreOptions {
  // The backup's wp-content/uploads/sites, holding one folder per subsite.
  uploadsDir: string
  // The backup's wp-content/plugins, for images plugins ship (the Ramadan
  // plugins' prayer walk photos).
  pluginsDir?: string
  // Further hosts that served this network's uploads, such as a subsite's
  // old mapped domain.
  hosts?: string[]
  // prayer.tools / pray4movement.org hosts that aren't this server (the
  // separate main sites, object storage); their URLs are kept.
  excludeHosts?: string[]
  // Where stored files go when S3 isn't configured.
  outDir?: string
  // The public base of stored files when S3 isn't configured.
  baseUrl?: string
}

// An image is stored as a resized WebP; audio and other files as they are.
export type FileKind = 'image' | 'audio' | 'file'

export interface KindReport {
  // Source files stored, or found already stored.
  copied: number
  // Of those, files written by this run.
  written: number
  // URLs of this network whose file isn't in the backup.
  missing: number
}

export interface ImageReport {
  // Totals over every kind.
  copied: number
  written: number
  // URLs of this network whose file isn't in the backup.
  missing: string[]
  // Files that couldn't be read or stored.
  failed: { url: string, error: string }[]
  // Image and audio addresses on other hosts, left unchanged; each URL counts once.
  external: number
  // Image and audio addresses of this network outside the folders read from
  // the backup, left unchanged.
  notUploads: string[]
  kinds: Record<FileKind, KindReport>
  // Source files copied, by extension.
  extensions: Record<string, number>
  // A copy WordPress made on re-upload (`name-1.jpg`) or another size, used when the named file is gone.
  substituted: { url: string, file: string }[]
}

export interface ImageStore {
  // Copies a document's images (`src` and `href`), audio and the files its
  // links point at, and returns it with their stored addresses. Images and
  // audio of this network that can't be copied are removed, and links to
  // such files lose their link, so nothing points at the WordPress server.
  rewrite(doc: TiptapDoc): Promise<TiptapDoc>
  // The stored image for a network image URL, or null when it isn't one or wasn't copied.
  resolveUrl(url: string): Promise<string | null>
  // The stored image for a network image URL, the URL unchanged when it is on
  // another host, or null when it is on this network but can't be copied.
  rewriteUrl(url: string): Promise<string | null>
  // The stored copy of a network file, kept as it is, or null.
  resolveFile(url: string, kind?: 'audio' | 'file'): Promise<string | null>
  report: ImageReport
}

const NETWORK = /(^|\.)(prayer\.tools|pray4movement\.org)$/i
const UPLOAD_PATH = /^\/wp-content\/uploads\/sites\/(\d+)\/(.+)$/
const PLUGIN_PATH = /^\/wp-content\/plugins\/(.+\.(?:jpe?g|png|gif|webp))$/i
const IMAGE_FILE = /\.(jpe?g|png|gif|webp|avif|bmp|tiff?|svg)$/i
const AUDIO_FILE = /\.(mp3|m4a|ogg|oga|wav)$/i
const IMAGE_VERSION = 'w1600-q78'
const REPO = join(import.meta.dir, '..', '..')

const CONTENT_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', wav: 'audio/wav',
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip', txt: 'text/plain', epub: 'application/epub+zip', mp4: 'video/mp4'
}

type Source = { kind: 'upload', path: string } | { kind: 'external' } | { kind: 'notUploads' }

export function createImageStore(opts: ImageStoreOptions): ImageStore {
  const hosts = new Set((opts.hosts ?? []).map(h => h.toLowerCase()))
  const excluded = new Set((opts.excludeHosts ?? []).map(h => h.toLowerCase()))
  const outDir = opts.outDir ?? join(REPO, 'apps', 'admin', '.data', 'uploads')
  const baseUrl = (opts.baseUrl ?? (process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:2380')).replace(/\/$/, '')
  const env = process.env
  const s3 = env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY && env.S3_BUCKET_NAME && env.S3_PUBLIC_BASE_URL
    ? new S3Client({ endPoint: env.S3_ENDPOINT, region: env.S3_REGION || 'us-west-004', bucket: env.S3_BUCKET_NAME, accessKey: env.S3_ACCESS_KEY_ID, secretKey: env.S3_SECRET_ACCESS_KEY, pathStyle: true })
    : null
  const kind = (): KindReport => ({ copied: 0, written: 0, missing: 0 })
  const report: ImageReport = { copied: 0, written: 0, missing: [], failed: [], external: 0, notUploads: [], kinds: { image: kind(), audio: kind(), file: kind() }, extensions: {}, substituted: [] }
  // A stored address; null for a network file that can't be copied; undefined for another host.
  const byUrl = new Map<string, Promise<string | null | undefined>>()
  const byFile = new Map<string, Promise<string | null>>()
  const listings = new Map<string, Promise<string[]>>()

  function source(url: string): Source {
    let u: URL
    try {
      u = new URL(url)
    } catch {
      return { kind: 'external' }
    }
    const host = u.hostname.toLowerCase()
    const ours = hosts.has(host) || (NETWORK.test(host) && !excluded.has(host))
    if (!/^https?:$/.test(u.protocol) || !ours) return { kind: 'external' }
    const upload = UPLOAD_PATH.exec(u.pathname)
    const plugin = opts.pluginsDir ? PLUGIN_PATH.exec(u.pathname) : null
    const [root, rest] = upload ? [join(opts.uploadsDir, upload[1]!), upload[2]!] : plugin ? [opts.pluginsDir!, plugin[1]!] : []
    if (!root || !rest) return { kind: 'notUploads' }
    const parts = rest.split('/').map(p => decode(p))
    if (parts.some(p => !p || p === '.' || p === '..' || p.includes('\\'))) return { kind: 'notUploads' }
    return { kind: 'upload', path: join(root, ...parts) }
  }

  // The file to read: the original upload when the URL names a size WordPress
  // generated from it (`name-300x200.jpg`, `name-scaled.jpg`), else the file
  // named, else a copy WordPress made when the same name was uploaded again
  // (`name-1.jpg`), else the first upload when a re-upload's file is gone,
  // else the largest other size of any of these.
  async function locate(path: string): Promise<{ file: string, substitute: boolean } | null> {
    const dir = dirname(path)
    const ext = extname(path)
    const name = basename(path, ext)
    const unsized = name.replace(/-\d+x\d+$/, '')
    const original = unsized.replace(/-(scaled|rotated)$/, '')
    for (const n of new Set([original, unsized, name])) {
      const p = join(dir, n + ext)
      if (await stat(p).then(s => s.isFile(), () => false)) return { file: p, substitute: false }
    }
    if (!listings.has(dir)) listings.set(dir, readdir(dir).catch(() => []))
    const escape = (t: string) => t.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&')
    const files = await listings.get(dir)!
    const lower = new Map(files.map(f => [f.toLowerCase(), f]))
    const copyOf = new RegExp(`^${escape(original)}-(\\d+)${escape(ext)}$`, 'i')
    const copies = files.map(f => ({ f, m: copyOf.exec(f) })).filter(x => x.m).sort((a, b) => Number(a.m![1]) - Number(b.m![1]))
    if (copies.length) return { file: join(dir, copies[0]!.f), substitute: true }
    // A re-upload's name (`name-2`) whose file is gone: the first upload's.
    const base = original.replace(/-\d+$/, '')
    const first = base !== original ? lower.get(`${base}${ext}`.toLowerCase()) : undefined
    if (first) return { file: join(dir, first), substitute: true }
    const names = [...new Set([original, base])].map(escape).join('|')
    const sized = new RegExp(`^(?:${names})(?:-\\d+)?(?:-scaled)?-(\\d+)x(\\d+)${escape(ext)}$`, 'i')
    let best: { file: string, area: number } | null = null
    for (const file of files) {
      const m = sized.exec(file)
      const area = m ? Number(m[1]) * Number(m[2]) : 0
      if (m && (!best || area > best.area)) best = { file, area }
    }
    return best ? { file: join(dir, best.file), substitute: true } : null
  }

  // Writes `name` unless it is already stored and returns its public address.
  async function put(name: string, folder: string, contentType: string, make: () => Promise<Buffer>, k: FileKind): Promise<string> {
    if (s3) {
      const key = `${folder}/${name}`
      const bucketName = env.S3_PUBLIC_BUCKET_NAME || env.S3_BUCKET_NAME
      if (!await s3.exists(key, { bucketName })) {
        await s3.putObject(key, new Uint8Array(await make()), { metadata: { 'Content-Type': contentType }, bucketName })
        report.written++
        report.kinds[k].written++
      }
      return `${env.S3_PUBLIC_BASE_URL!.replace(/\/$/, '')}/${key}`
    }
    const path = join(outDir, name)
    if (!await access(path).then(() => true, () => false)) {
      const bytes = await make()
      await mkdir(outDir, { recursive: true })
      await writeFile(path, bytes)
      report.written++
      report.kinds[k].written++
    }
    return `${baseUrl}/uploads/${name}`
  }

  function store(input: Buffer, file: string, k: FileKind): Promise<string> {
    if (k === 'image') {
      const name = `${createHash('sha256').update(IMAGE_VERSION).update(input).digest('hex').slice(0, 32)}.webp`
      return put(name, 'pt-images', 'image/webp', () => sharp(input, { failOn: 'error' }).rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer(), k)
    }
    // Lower case and `ogg` for `oga`, the names the uploads route knows.
    const ext = extname(file).slice(1).toLowerCase().replace(/^oga$/, 'ogg')
    const name = `${createHash('sha256').update(input).digest('hex').slice(0, 32)}${ext ? `.${ext}` : ''}`
    return put(name, k === 'audio' ? 'pt-audio' : 'pt-files', CONTENT_TYPES[ext] ?? 'application/octet-stream', async () => input, k)
  }

  // `strict` counts addresses that aren't copyable files of this network
  // (an image or audio source); links to pages are left alone silently.
  async function copy(url: string, k: FileKind, strict: boolean): Promise<string | null | undefined> {
    const src = source(url)
    if (src.kind === 'external') {
      if (strict) report.external++
      return undefined
    }
    // A link to a page of the network stays; it redirects to the page's new home.
    if (src.kind === 'notUploads') {
      if (!strict) return undefined
      report.notUploads.push(url)
      return null
    }
    const found = await locate(src.path)
    if (!found) {
      report.missing.push(url)
      report.kinds[k].missing++
      return null
    }
    const file = found.file
    if (found.substitute) report.substituted.push({ url, file: file.slice(opts.uploadsDir.length + 1) })
    const key = `${k}|${file}`
    if (!byFile.has(key)) {
      byFile.set(key, (async () => {
        try {
          const stored = await store(await readFile(file), file, k)
          const ext = extname(file).slice(1).toLowerCase() || '(none)'
          report.copied++
          report.kinds[k].copied++
          report.extensions[ext] = (report.extensions[ext] ?? 0) + 1
          return stored
        } catch (err) {
          report.failed.push({ url, error: err instanceof Error ? err.message : String(err) })
          return null
        }
      })())
    }
    return byFile.get(key)!
  }

  function resolve(url: string, k: FileKind, strict: boolean): Promise<string | null | undefined> {
    const key = `${k}|${url.trim()}`
    if (!byUrl.has(key)) byUrl.set(key, copy(url.trim(), k, strict))
    return byUrl.get(key)!
  }

  // A link or image link to a file of this network: its stored copy, null
  // when the file can't be copied, or the address unchanged.
  async function rewriteHref(href: unknown): Promise<unknown> {
    if (typeof href !== 'string' || source(href.trim()).kind !== 'upload') return href
    const path = new URL(href.trim()).pathname
    const k: FileKind = IMAGE_FILE.test(path) ? 'image' : AUDIO_FILE.test(path) ? 'audio' : 'file'
    const stored = await resolve(href, k, false)
    return stored === undefined ? href : stored
  }

  // The node with its files' stored addresses, or null to remove it.
  async function rewriteNode(n: TiptapNode): Promise<TiptapNode | null> {
    let attrs = n.attrs
    const src = n.attrs?.src
    if ((n.type === 'image' || n.type === 'audio') && typeof src === 'string') {
      const stored = await resolve(src, n.type, true)
      if (stored === null) return null
      attrs = { ...attrs, src: stored ?? src }
      if (n.type === 'image' && attrs.href !== undefined) {
        const href = await rewriteHref(attrs.href)
        if (href === null) delete attrs.href
        else attrs.href = href
      }
    }
    let marks = n.marks
    if (marks?.some(m => m.type === 'link')) {
      marks = []
      for (const m of n.marks!) {
        if (m.type !== 'link') { marks.push(m); continue }
        const href = await rewriteHref(m.attrs?.href)
        if (href !== null) marks.push({ ...m, attrs: { ...m.attrs, href } })
      }
    }
    let content: TiptapNode[] | undefined
    if (n.content) {
      content = []
      for (const c of n.content) {
        const r = await rewriteNode(c)
        if (r) content.push(r)
      }
    }
    return { ...n, ...(attrs ? { attrs } : {}), ...(marks ? { marks } : {}), ...(content ? { content } : {}) }
  }

  return {
    rewrite: async doc => (await rewriteNode(doc as TiptapNode) ?? { type: 'doc', content: [] }) as TiptapDoc,
    resolveUrl: async url => (await resolve(url, 'image', true)) ?? null,
    rewriteUrl: async (url) => {
      const stored = await resolve(url, 'image', true)
      return stored === undefined ? url : stored
    },
    resolveFile: async (url, k = AUDIO_FILE.test(url.split(/[?#]/)[0] ?? '') ? 'audio' : 'file') => (await resolve(url, k, true)) ?? null,
    report
  }
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}
