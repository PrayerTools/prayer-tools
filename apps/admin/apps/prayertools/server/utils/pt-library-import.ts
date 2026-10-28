// Content packs for platform libraries: a pack.json (library details and
// entries) on its own, or zipped with an images/ folder that entries reference
// as "images/<file>". An import creates a library or replaces an existing
// platform library's details and entries; entries missing from the pack are
// removed. A dry run reports what would change without writing anything.
import { unzipSync, strFromU8 } from 'fflate'
import { sql } from 'kysely'
import { pgArray, jsonb } from '@prayertools/shared/db/json'
import { isLanguage } from '@prayertools/shared/languages'
import { textDoc } from '@prayertools/shared/tiptap'
import type { TiptapDoc, TiptapNode } from '@prayertools/shared/db/schema'

export const PT_PACK_MAX_BYTES = 50 * 1024 * 1024
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_ENTRIES = 20_000

export interface PtPack {
  meta: Record<string, unknown>
  title: string
  entries: { day: number, language: string, doc: TiptapDoc }[]
  images: Map<string, Uint8Array>
  skipped: string[]
}

export interface PtPackSummary {
  title: string
  target: { id: string, title: string } | null
  titleMatch: string | null
  days: number
  languages: string[]
  images: number
  added: number
  changed: number
  removed: number
  unchanged: number
  skipped: string[]
}

// WordPress prayer fuel HTML as headings, paragraphs, list items and quotes.
export function ptHtmlToDoc(html: string): TiptapDoc {
  const blocks: TiptapNode[] = []
  const decode = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, '\'').trim()
  const re = /<(h[1-6]|p|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const text = decode(m[2]!)
    if (!text) continue
    const tag = m[1]!.toLowerCase()
    if (tag.startsWith('h')) blocks.push({ type: 'heading', attrs: { level: Math.min(4, Number(tag[1])) }, content: [{ type: 'text', text }] })
    else if (tag === 'blockquote') blocks.push({ type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
    else blocks.push({ type: 'paragraph', content: [{ type: 'text', text: tag === 'li' ? `• ${text}` : text }] })
  }
  return blocks.length ? { type: 'doc', content: blocks } : textDoc(decode(html))
}

// JSON with object keys sorted, so a doc compares equal to its jsonb copy
// (Postgres reorders keys).
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]]))
    : v)
}

function isZip(data: Uint8Array): boolean {
  return data[0] === 0x50 && data[1] === 0x4B && data[2] === 0x03 && data[3] === 0x04
}

function imageRefs(node: TiptapNode, out: Set<string>): void {
  const src = node.attrs?.src
  if (node.type === 'image' && typeof src === 'string' && !/^https?:\/\//.test(src)) out.add(src.replace(/^\.?\//, ''))
  for (const child of node.content ?? []) imageRefs(child, out)
}

function withImageUrls(node: TiptapNode, urls: Map<string, string>): TiptapNode {
  const src = node.attrs?.src
  const local = node.type === 'image' && typeof src === 'string' ? urls.get(src.replace(/^\.?\//, '')) : undefined
  return {
    ...node,
    ...(local ? { attrs: { ...node.attrs, src: local } } : {}),
    ...(node.content ? { content: node.content.map(c => withImageUrls(c, urls)) } : {})
  }
}

export function ptReadPack(data: Uint8Array): PtPack {
  if (data.length > PT_PACK_MAX_BYTES) ptBadRequest('Packs can be up to 50 MB.')
  let json: string
  const images = new Map<string, Uint8Array>()
  if (isZip(data)) {
    let files: Record<string, Uint8Array>
    try {
      files = unzipSync(data)
    } catch {
      ptBadRequest('That zip file can\'t be read.')
    }
    const packPath = Object.keys(files).filter(p => p.split('/').pop() === 'pack.json').sort((a, b) => a.length - b.length)[0]
    if (!packPath) ptBadRequest('The zip has no pack.json.')
    const root = packPath.slice(0, -'pack.json'.length)
    for (const [path, bytes] of Object.entries(files)) {
      if (!path.startsWith(`${root}images/`) || path.endsWith('/')) continue
      if (bytes.length > MAX_IMAGE_BYTES) ptBadRequest(`${path} is larger than 20 MB.`)
      images.set(path.slice(root.length), bytes)
    }
    json = strFromU8(files[packPath]!)
  } else {
    json = new TextDecoder().decode(data)
  }

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(json)
  } catch {
    ptBadRequest('pack.json isn\'t valid JSON.')
  }
  const meta: Record<string, unknown> = { description: null, license_note: null, credit: null, topics: pgArray([]), template_keys: pgArray([]), ...ptLibraryMeta(raw) }
  const list = Array.isArray(raw.entries) ? raw.entries as Record<string, unknown>[] : []
  if (!list.length) ptBadRequest('The pack has no entries.')
  if (list.length > MAX_ENTRIES) ptBadRequest(`Packs can have up to ${MAX_ENTRIES} entries.`)

  const entries: PtPack['entries'] = []
  const skipped: string[] = []
  const seen = new Set<string>()
  for (const e of list) {
    const day = Number(e.day)
    const language = String(e.language ?? '')
    const label = `day ${e.day ?? '?'} ${language || '?'}`
    if (!Number.isInteger(day) || day < 1) {
      skipped.push(`${label}: not a day number`)
      continue
    }
    if (!isLanguage(language)) {
      skipped.push(`${label}: unknown language`)
      continue
    }
    if (seen.has(`${day}:${language}`)) {
      skipped.push(`${label}: listed twice`)
      continue
    }
    const doc = e.doc ? ptDoc(e.doc) : typeof e.html === 'string' ? ptHtmlToDoc(e.html) : typeof e.text === 'string' ? textDoc(e.text) : null
    if (!doc) {
      skipped.push(`${label}: no content`)
      continue
    }
    seen.add(`${day}:${language}`)
    entries.push({ day, language, doc })
  }
  if (!entries.length) ptBadRequest('None of the pack\'s entries can be imported.')

  const refs = new Set<string>()
  for (const e of entries) imageRefs(e.doc, refs)
  const missing = [...refs].filter(r => !images.has(r))
  if (missing.length) ptBadRequest(`Images missing from the zip: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}.`)
  for (const name of images.keys()) if (!refs.has(name)) images.delete(name)

  return { meta, title: String(meta.title), entries, images, skipped }
}

// The platform library a pack would update: the one chosen, or (for "auto")
// one with the pack's title; null means a new library.
async function resolveTarget(target: string, title: string): Promise<{ id: string, title: string } | null> {
  const db = ptAdminDb()
  if (target === 'new') return null
  if (target === 'auto') {
    return await db.selectFrom('pt_library').select(['id', 'title']).where('owner_user_id', 'is', null).where('title', '=', title).executeTakeFirst() ?? null
  }
  const lib = /^[0-9a-f-]{36}$/i.test(target)
    ? await db.selectFrom('pt_library').select(['id', 'title']).where('owner_user_id', 'is', null).where('id', '=', target).executeTakeFirst()
    : undefined
  if (!lib) ptBadRequest('Choose a platform library to update, or a new library.')
  return lib
}

export async function ptPackSummary(pack: PtPack, target: string): Promise<PtPackSummary> {
  const db = ptAdminDb()
  const lib = await resolveTarget(target, pack.title)
  const match = await db.selectFrom('pt_library').select('id').where('owner_user_id', 'is', null).where('title', '=', pack.title).executeTakeFirst()
  const existing = lib
    ? await db.selectFrom('pt_library_entry').select(['day', 'language', 'draft']).where('library_id', '=', lib.id).execute()
    : []
  const before = new Map(existing.map(e => [`${e.day}:${e.language}`, canonical(e.draft)]))
  let added = 0
  let changed = 0
  let unchanged = 0
  for (const e of pack.entries) {
    const prev = before.get(`${e.day}:${e.language}`)
    if (prev === undefined) added++
    else if (prev === canonical(e.doc)) unchanged++
    else changed++
  }
  const keep = new Set(pack.entries.map(e => `${e.day}:${e.language}`))
  return {
    title: pack.title,
    target: lib,
    titleMatch: match?.id ?? null,
    days: Math.max(...pack.entries.map(e => e.day)),
    languages: [...new Set(pack.entries.map(e => e.language))],
    images: pack.images.size,
    added,
    changed,
    removed: existing.filter(e => !keep.has(`${e.day}:${e.language}`)).length,
    unchanged,
    skipped: pack.skipped
  }
}

export async function ptApplyPack(pack: PtPack, target: string, publish: boolean): Promise<{ id: string, version: number | null }> {
  const lib = await resolveTarget(target, pack.title)
  const urls = new Map<string, string>()
  for (const [name, bytes] of pack.images) urls.set(name, await ptStoreLibraryImage(Buffer.from(bytes)))
  const entries = pack.entries.map(e => ({ ...e, doc: withImageUrls(e.doc, urls) as TiptapDoc }))

  const id = await ptAdminDb().transaction().execute(async (tx) => {
    const meta = { ...pack.meta, updated_at: new Date() }
    const id = lib
      ? (await tx.updateTable('pt_library').set(meta as never).where('id', '=', lib.id).returning('id').executeTakeFirstOrThrow()).id
      : (await tx.insertInto('pt_library').values({ ...meta, owner_user_id: null, visibility: 'published' } as never).returning('id').executeTakeFirstOrThrow()).id
    for (const e of entries) {
      await tx.insertInto('pt_library_entry').values({ library_id: id, day: e.day, language: e.language, draft: jsonb(e.doc), published: null } as never)
        .onConflict(oc => oc.columns(['library_id', 'day', 'language']).doUpdateSet({ draft: jsonb(e.doc) as never, updated_at: new Date() } as never)).execute()
    }
    const keep = entries.map(e => `${e.day}:${e.language}`)
    await tx.deleteFrom('pt_library_entry').where('library_id', '=', id)
      .where(sql<boolean>`(day::text || ':' || language) <> ALL(${pgArray(keep)})`).execute()
    return id
  })
  const version = publish ? await ptPublishLibrary(id) : null
  return { id, version }
}
