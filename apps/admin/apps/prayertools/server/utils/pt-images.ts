// Uploads: personal-library images resized for slow connections (a large and
// a small WebP), and landing-section videos and prayer-content audio stored as
// uploaded, kept in object storage, or on local disk under `.data/uploads`
// when S3 isn't configured (development).
import { access, mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, normalize } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import sharp from 'sharp'
import { S3Client } from '@bradenmacdonald/s3-lite-client'
import { uploadToS3 } from '#core/server/utils/storage'

const LOCAL_DIR = join(process.cwd(), '.data', 'uploads')

function s3Configured(): boolean {
  return !!(process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY_ID && process.env.S3_BUCKET_NAME && process.env.S3_PUBLIC_BASE_URL)
}

async function store(buf: Buffer, name: string, contentType: string, folder = 'pt-images'): Promise<{ key: string, url: string }> {
  if (s3Configured()) {
    const res = await uploadToS3(buf, name, contentType, 'public', folder)
    return { key: res.key, url: res.url }
  }
  const key = `${randomBytes(16).toString('hex')}.${name.split('.').pop()}`
  await mkdir(LOCAL_DIR, { recursive: true })
  await writeFile(join(LOCAL_DIR, key), buf)
  const base = (process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:2380').replace(/\/$/, '')
  return { key: `local/${key}`, url: `${base}/uploads/${key}` }
}

// Library images are named by a hash of the source image, so importing the
// same image again reuses the stored file instead of adding a copy.
const LIBRARY_IMAGE_VERSION = 'w1600-q78'
let libraryClient: S3Client | null = null

const STORED_NAME = /^[0-9a-f]{32}\.webp$/

function libraryImageBase(): string {
  const env = process.env
  return s3Configured()
    ? `${env.S3_PUBLIC_BASE_URL!.replace(/\/$/, '')}/pt-images/`
    : `${(env.NUXT_PUBLIC_SITE_URL || 'http://localhost:2380').replace(/\/$/, '')}/uploads/`
}

// The stored name for a pack image. A file already named like a stored library
// image (as `pt libraries pull` writes them) keeps its name, so pulling and
// pushing a pack leaves its entries unchanged.
export function ptLibraryImageName(fileName: string, input: Uint8Array): string {
  const base = fileName.split('/').pop() ?? ''
  if (STORED_NAME.test(base)) return base
  return `${createHash('sha256').update(LIBRARY_IMAGE_VERSION).update(input).digest('hex').slice(0, 32)}.webp`
}

export function ptLibraryImageUrl(name: string): string {
  return `${libraryImageBase()}${name}`
}

// The stored name of a library image URL on this server's storage, or null.
export function ptStoredLibraryImageName(url: string): string | null {
  const base = libraryImageBase()
  if (!url.startsWith(base)) return null
  const name = url.slice(base.length)
  return STORED_NAME.test(name) ? name : null
}

// An image inside a library entry: one WebP of up to 1600 px, stored under
// `name` unless a file of that name is already stored; returns its URL.
export async function ptStoreLibraryImage(input: Buffer, name = ptLibraryImageName('', input)): Promise<string> {
  const resize = () => sharp(input, { failOn: 'error' }).rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer()
  const env = process.env
  if (s3Configured()) {
    libraryClient ??= new S3Client({ endPoint: env.S3_ENDPOINT!, region: env.S3_REGION || 'us-west-004', bucket: env.S3_BUCKET_NAME!, accessKey: env.S3_ACCESS_KEY_ID, secretKey: env.S3_SECRET_ACCESS_KEY, pathStyle: true })
    const key = `pt-images/${name}`
    const bucketName = env.S3_PUBLIC_BUCKET_NAME || env.S3_BUCKET_NAME
    if (!await libraryClient.exists(key, { bucketName })) {
      await libraryClient.putObject(key, await resize(), { metadata: { 'Content-Type': 'image/webp' }, bucketName })
    }
    return ptLibraryImageUrl(name)
  }
  await mkdir(LOCAL_DIR, { recursive: true })
  const path = join(LOCAL_DIR, name)
  if (!await access(path).then(() => true, () => false)) await writeFile(path, await resize())
  return ptLibraryImageUrl(name)
}

export async function ptReadLocalUpload(key: string): Promise<Buffer | null> {
  const safe = normalize(key).replace(/^(\.\.[/\\])+/, '')
  if (safe.includes('/') || safe.includes('\\')) return null
  return await readFile(join(LOCAL_DIR, safe)).catch(() => null)
}

export async function ptProcessImage(input: Buffer): Promise<{ key: string, url: string, urlSmall: string, width: number, height: number }> {
  const img = sharp(input, { failOn: 'error' }).rotate()
  const meta = await img.metadata()
  if (!meta.width || !meta.height) ptBadRequest('That file is not an image we can read.')
  const large = await img.clone().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer({ resolveWithObject: true })
  const small = await img.clone().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).webp({ quality: 70 }).toBuffer()
  const main = await store(large.data, 'image.webp', 'image/webp')
  const thumb = await store(small, 'image-small.webp', 'image/webp')
  return { key: main.key, url: main.url, urlSmall: thumb.url, width: large.info.width, height: large.info.height }
}

export const PT_VIDEO_TYPES: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' }

export async function ptStoreVideo(input: Buffer, contentType: string): Promise<{ key: string, url: string }> {
  const ext = PT_VIDEO_TYPES[contentType]
  if (!ext) ptBadRequest('Upload an MP4, WebM or MOV video.')
  return await store(input, `video.${ext}`, contentType, 'pt-videos')
}

// Audio formats by extension: the type a file is stored and served as, and
// the types browsers send for it.
export const PT_AUDIO_FORMATS: Record<string, { type: string, sent: string[] }> = {
  mp3: { type: 'audio/mpeg', sent: ['audio/mpeg', 'audio/mp3'] },
  m4a: { type: 'audio/mp4', sent: ['audio/mp4', 'audio/x-m4a', 'audio/m4a'] },
  ogg: { type: 'audio/ogg', sent: ['audio/ogg', 'application/ogg'] },
  wav: { type: 'audio/wav', sent: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'] }
}

// A file sent without a usable type is recognised by its name's extension.
export async function ptStoreAudio(input: Buffer, contentType: string, fileName = ''): Promise<{ key: string, url: string }> {
  const named = fileName.split('.').pop()?.toLowerCase() ?? ''
  const untyped = !contentType || contentType === 'application/octet-stream'
  const ext = Object.keys(PT_AUDIO_FORMATS).find(e => PT_AUDIO_FORMATS[e]!.sent.includes(contentType))
    ?? (untyped && named in PT_AUDIO_FORMATS ? named : null)
  if (!ext) ptBadRequest('Upload an MP3, M4A, OGG or WAV file.')
  return await store(input, `audio.${ext}`, PT_AUDIO_FORMATS[ext]!.type, 'pt-audio')
}
