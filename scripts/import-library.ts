// Imports content packs as published platform libraries. A pack is the
// operator import format (title, cadence, source_language, license, license_note, credit,
// topics, template_keys, entries of { day, language, doc }). A platform
// library with the same title is updated in place and republished, so sites
// following it get the new version; entries missing from the pack are removed.
// A pack is a pack.json or a zip of pack.json and images/; images referenced as
// "images/<file>" are resized and uploaded to public storage (or
// apps/admin/.data/uploads when S3 isn't configured). Production imports go
// through the operator Libraries page instead.
// Usage: DATABASE_URL=… bun run scripts/import-library.ts <pack.zip|pack.json>...
import { access, readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { unzipSync, strFromU8 } from 'fflate'
import { sql } from 'kysely'
import sharp from 'sharp'
import { S3Client } from '@bradenmacdonald/s3-lite-client'
import { createDb } from '@prayertools/shared/db/connect'
import { jsonb, pgArray } from '@prayertools/shared/db/json'
import { isLanguage } from '@prayertools/shared/languages'
import { LICENSES } from '@prayertools/shared/content'
import type { TiptapDoc, TiptapNode } from '@prayertools/shared/db/schema'

interface Pack {
  title: string
  description?: string
  cadence: 'daily' | 'weekly' | 'monthly'
  source_language: string
  license: string
  license_note?: string | null
  credit?: string
  topics?: string[]
  template_keys?: string[]
  entries: { day: number, language: string, doc: TiptapDoc }[]
}

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')
const files = process.argv.slice(2)
if (!files.length) throw new Error('Usage: bun run scripts/import-library.ts <pack.json>...')
const db = createDb(url)

const env = process.env
const s3 = env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY && env.S3_BUCKET_NAME && env.S3_PUBLIC_BASE_URL
  ? new S3Client({ endPoint: env.S3_ENDPOINT, region: env.S3_REGION || 'us-west-004', bucket: env.S3_BUCKET_NAME, accessKey: env.S3_ACCESS_KEY_ID, secretKey: env.S3_SECRET_ACCESS_KEY, pathStyle: true })
  : null

// Named like the admin's library images (a hash of the source image), so the
// script and the operator import share stored files and never add copies.
let uploadCount = 0
async function store(input: Uint8Array): Promise<string> {
  const name = `${createHash('sha256').update('w1600-q78').update(input).digest('hex').slice(0, 32)}.webp`
  const resize = () => sharp(input).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer()
  if (s3) {
    const key = `pt-images/${name}`
    const bucketName = env.S3_PUBLIC_BUCKET_NAME || env.S3_BUCKET_NAME
    if (!await s3.exists(key, { bucketName })) {
      await s3.putObject(key, await resize(), { metadata: { 'Content-Type': 'image/webp' }, bucketName })
      uploadCount++
    }
    return `${env.S3_PUBLIC_BASE_URL!.replace(/\/$/, '')}/${key}`
  }
  const dir = join(import.meta.dir, '..', 'apps', 'admin', '.data', 'uploads')
  await mkdir(dir, { recursive: true })
  if (!await access(join(dir, name)).then(() => true, () => false)) {
    await writeFile(join(dir, name), await resize())
    uploadCount++
  }
  return `${(env.NUXT_PUBLIC_SITE_URL || 'http://localhost:2380').replace(/\/$/, '')}/uploads/${name}`
}

async function uploadImage(images: Map<string, Uint8Array>, uploaded: Map<string, string>, src: string): Promise<string> {
  if (!uploaded.has(src)) {
    const input = images.get(src)
    if (!input) throw new Error(`Image ${src} is missing from the zip`)
    uploaded.set(src, await store(input))
  }
  return uploaded.get(src)!
}

async function withUploads(node: TiptapNode, images: Map<string, Uint8Array>, uploaded: Map<string, string>): Promise<TiptapNode> {
  const src = node.attrs?.src
  const local = node.type === 'image' && typeof src === 'string' && !/^https?:\/\//.test(src)
  const attrs = local ? { ...node.attrs, src: await uploadImage(images, uploaded, src.replace(/^\.?\//, '')) } : node.attrs
  let content: TiptapNode[] | undefined
  if (node.content) {
    content = []
    for (const c of node.content) content.push(await withUploads(c, images, uploaded))
  }
  return { ...node, ...(attrs ? { attrs } : {}), ...(content ? { content } : {}) }
}

async function readPack(file: string): Promise<{ pack: Pack, images: Map<string, Uint8Array> }> {
  const data = new Uint8Array(await readFile(file))
  const images = new Map<string, Uint8Array>()
  if (data[0] !== 0x50 || data[1] !== 0x4B) return { pack: JSON.parse(new TextDecoder().decode(data)), images }
  const files = unzipSync(data)
  if (!files['pack.json']) throw new Error(`${file}: the zip has no pack.json`)
  for (const [path, bytes] of Object.entries(files)) if (path.startsWith('images/') && !path.endsWith('/')) images.set(path, bytes)
  return { pack: JSON.parse(strFromU8(files['pack.json'])), images }
}

function check(pack: Pack, file: string): void {
  const fail = (m: string) => { throw new Error(`${file}: ${m}`) }
  if (!pack.title || pack.title.length > 120) fail('title must be 1–120 characters')
  if (pack.cadence !== 'daily' && pack.cadence !== 'weekly' && pack.cadence !== 'monthly') fail('cadence must be daily, weekly or monthly')
  if (!isLanguage(pack.source_language)) fail(`unknown source language ${pack.source_language}`)
  if (!(LICENSES as readonly string[]).includes(pack.license)) fail(`license must be one of ${LICENSES.join(', ')}`)
  if (!pack.entries?.length) fail('no entries')
  for (const e of pack.entries) {
    if (!Number.isInteger(e.day) || e.day < 1) fail(`bad day ${e.day}`)
    if (!isLanguage(e.language)) fail(`unknown language ${e.language}`)
    if (e.doc?.type !== 'doc') fail(`day ${e.day} ${e.language} is not a Tiptap doc`)
  }
}

for (const file of files) {
  const { pack, images } = await readPack(file)
  check(pack, file)
  const uploaded = new Map<string, string>()
  const entries: Pack['entries'] = []
  for (const e of pack.entries) entries.push({ ...e, doc: await withUploads(e.doc, images, uploaded) as TiptapDoc })
  const meta = {
    title: pack.title,
    description: pack.description ?? null,
    cadence: pack.cadence,
    source_language: pack.source_language,
    license: pack.license,
    license_note: pack.license_note ?? null,
    credit: pack.credit ?? null,
    topics: pgArray((pack.topics ?? []).map(t => t.toLowerCase())),
    template_keys: pgArray(pack.template_keys ?? []),
    visibility: 'published' as const,
    updated_at: new Date()
  }
  const result = await db.transaction().execute(async (tx) => {
    const existing = await tx.selectFrom('pt_library').select(['id', 'published_version'])
      .where('owner_user_id', 'is', null).where('title', '=', pack.title).forUpdate().executeTakeFirst()
    const lib = existing
      ? (await tx.updateTable('pt_library').set(meta).where('id', '=', existing.id).returning(['id', 'published_version']).executeTakeFirstOrThrow())
      : (await tx.insertInto('pt_library').values({ ...meta, owner_user_id: null }).returning(['id', 'published_version']).executeTakeFirstOrThrow())
    for (const e of entries) {
      await tx.insertInto('pt_library_entry').values({ library_id: lib.id, day: e.day, language: e.language, draft: jsonb(e.doc), published: null })
        .onConflict(oc => oc.columns(['library_id', 'day', 'language']).doUpdateSet({ draft: jsonb(e.doc), updated_at: new Date() })).execute()
    }
    const keep = new Set(entries.map(e => `${e.day}:${e.language}`))
    const rows = await tx.selectFrom('pt_library_entry').select(['id', 'day', 'language']).where('library_id', '=', lib.id).execute()
    const gone = rows.filter(r => !keep.has(`${r.day}:${r.language}`)).map(r => r.id)
    if (gone.length) await tx.deleteFrom('pt_library_entry').where('id', 'in', gone).execute()
    const version = lib.published_version + 1
    await tx.updateTable('pt_library_entry').set({ published: sql`draft`, published_version: version }).where('library_id', '=', lib.id).execute()
    const languages = [...new Set(entries.map(e => e.language))]
    await tx.updateTable('pt_library').set({
      published_version: version,
      published_at: new Date(),
      entry_count: Math.max(...entries.map(e => e.day)),
      languages: pgArray(languages)
    }).where('id', '=', lib.id).execute()
    return { id: lib.id, version, created: !existing, languages, removed: gone.length }
  })
  console.log(`${pack.title}: ${result.created ? 'created' : 'updated'} library ${result.id}, version ${result.version}, ${entries.length} entries in ${result.languages.join(', ')}${result.removed ? `, ${result.removed} removed` : ''}`)
}
if (uploadCount) console.log(`Uploaded ${uploadCount} images to ${s3 ? 'S3' : 'local uploads'}.`)
await db.destroy()
