// Content packs on disk: a folder with pack.json and an images/ folder, a zip
// of the same, or a bare pack.json. Uploads always go as a zip.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { strFromU8, unzipSync, zipSync } from 'fflate'
import { CliError } from './auth'

export interface PackSource {
  path: string
  label: string
}

const isPackFile = (name: string) => name.endsWith('.zip') || name.endsWith('.json')
const isPackFolder = (dir: string) => existsSync(join(dir, 'pack.json'))

// The packs named by `args`: pack folders, pack files, or folders holding them.
export function findPacks(args: string[]): PackSource[] {
  const out: PackSource[] = []
  for (const arg of args) {
    const path = resolve(arg)
    if (!existsSync(path)) throw new CliError(`${arg} doesn't exist.`)
    const label = relative(process.cwd(), path) || basename(path)
    if (statSync(path).isFile()) {
      if (!isPackFile(path)) throw new CliError(`${arg} isn't a pack (.zip, .json or a folder with pack.json).`)
      out.push({ path, label })
    } else if (isPackFolder(path)) {
      out.push({ path, label })
    } else {
      const found = readdirSync(path).sort().map(n => join(path, n))
        .filter(p => statSync(p).isDirectory() ? isPackFolder(p) : isPackFile(p))
      if (!found.length) throw new CliError(`No packs in ${arg}.`)
      for (const p of found) out.push({ path: p, label: relative(process.cwd(), p) })
    }
  }
  return out
}

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? filesUnder(p) : name.startsWith('.') ? [] : [p]
  })
}

// The pack as bytes the import route reads.
export function packBytes(source: PackSource): Uint8Array {
  if (statSync(source.path).isFile()) return new Uint8Array(readFileSync(source.path))
  const files: Record<string, Uint8Array> = { 'pack.json': new Uint8Array(readFileSync(join(source.path, 'pack.json'))) }
  for (const file of filesUnder(join(source.path, 'images'))) {
    files[relative(source.path, file).split(sep).join('/')] = new Uint8Array(readFileSync(file))
  }
  return zipSync(files, { level: 0 })
}

export function writePackFolder(dir: string, pack: unknown, images: { path: string, bytes: Uint8Array }[]): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'pack.json'), `${JSON.stringify(pack, null, 2)}\n`)
  for (const img of images) {
    const target = resolve(dir, img.path)
    if (!target.startsWith(resolve(dir) + sep)) throw new CliError(`Refusing to write ${img.path} outside ${dir}.`)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, img.bytes)
  }
}

// Unpacks a pack zip into a folder, taking pack.json and images/ from the
// shallowest folder in the zip that has a pack.json.
export function unzipPack(zipPath: string, dir: string): { entries: number, images: number } {
  const files = unzipSync(new Uint8Array(readFileSync(zipPath)))
  const packPath = Object.keys(files).filter(p => p.split('/').pop() === 'pack.json').sort((a, b) => a.length - b.length)[0]
  if (!packPath) throw new CliError(`${zipPath} has no pack.json.`)
  const root = packPath.slice(0, -'pack.json'.length)
  const pack = JSON.parse(strFromU8(files[packPath]!)) as { entries?: unknown[] }
  const images = Object.entries(files)
    .filter(([p]) => p.startsWith(`${root}images/`) && !p.endsWith('/'))
    .map(([p, bytes]) => ({ path: p.slice(root.length), bytes }))
  writePackFolder(dir, pack, images)
  return { entries: pack.entries?.length ?? 0, images: images.length }
}
