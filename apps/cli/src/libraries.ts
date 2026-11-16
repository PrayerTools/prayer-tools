// `pt libraries …`: platform libraries through the admin's operator routes.
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Api, CliError, type ApiError } from './auth'
import { findPacks, packBytes, writePackFolder } from './packs'
import { confirm } from './prompt'

interface PackSummary {
  title: string
  key: string | null
  target: { id: string, title: string } | null
  metaChanged: boolean
  titleMatch: string | null
  days: number
  languages: string[]
  images: number
  added: number
  changed: number
  removed: number
  kept: number
  unchanged: number
  skipped: string[]
  edited: string[]
}

interface PlatformLibrary {
  id: string
  key: string | null
  title: string
  languages: string[]
  entry_count: number
  published_version: number
  drafts: number
}

interface Following {
  site: { slug: string, name: string }
  campaigns: string[]
}

export interface Flags {
  yes: boolean
  publish: boolean
  overwrite: boolean
  detach: boolean
}

const host = (api: Api) => new URL(api.url).host
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function form(bytes: Uint8Array, fields: Record<string, string>): FormData {
  const f = new FormData()
  f.append('file', new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), 'pack.zip')
  for (const [k, v] of Object.entries(fields)) f.append(k, v)
  return f
}

export async function list(api: Api): Promise<void> {
  const { libraries } = await api.request<{ libraries: PlatformLibrary[] }>('GET', '/api/pt/admin/libraries/platform')
  if (!libraries.length) {
    console.log(`No platform libraries on ${host(api)}.`)
    return
  }
  const rows = libraries.map(l => [l.key ?? '—', l.title, `v${l.published_version}`, `${l.entry_count} days`, l.languages.join(','), l.drafts ? `${l.drafts} unpublished` : ''])
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map(r => r[i]!.length)))
  for (const r of rows) console.log(r.map((c, i) => c.padEnd(widths[i]!)).join('  ').trimEnd())
}

function describe(s: PackSummary): string {
  const head = s.target
    ? `updates “${s.target.title}”${s.target.title !== s.title ? ` (renamed “${s.title}”)` : ''}`
    : `creates “${s.title}”`
  const counts = s.target
    ? [`+${s.added} new`, `${s.changed} changed`, `${s.removed} removed`, `${s.unchanged} unchanged`, ...(s.kept ? [`${s.kept} published kept`] : [])]
    : [`${s.added} entries`, plural(s.languages.length, 'language')]
  return `${head}: ${counts.join(', ')}${s.metaChanged && s.target ? ', details changed' : ''}`
}

const upToDate = (s: PackSummary) => !!s.target && !s.metaChanged && s.added + s.changed + s.removed === 0

export async function push(api: Api, paths: string[], flags: Flags): Promise<void> {
  const sources = findPacks(paths)
  const plans: { label: string, bytes: Uint8Array, summary: PackSummary }[] = []
  let failed = 0
  for (const source of sources) {
    try {
      const bytes = packBytes(source)
      const { summary } = await api.request<{ summary: PackSummary }>('POST', '/api/pt/admin/libraries/import', form(bytes, { target: 'auto' }))
      plans.push({ label: source.label, bytes, summary })
    } catch (err) {
      failed++
      console.error(`✗ ${source.label}: ${(err as Error).message}`)
    }
  }

  const { libraries } = await api.request<{ libraries: PlatformLibrary[] }>('GET', '/api/pt/admin/libraries/platform')
  const drafts = new Map(libraries.map(l => [l.id, l.drafts]))
  const blocked = plans.filter(p => p.summary.edited.length && !flags.overwrite)
  const toWrite = plans.filter(p => !upToDate(p.summary) && !blocked.includes(p))
  const toPublish = flags.publish ? plans.filter(p => upToDate(p.summary) && (drafts.get(p.summary.target!.id) ?? 0) > 0) : []

  console.log(`\nOn ${host(api)}:`)
  for (const p of plans) {
    const s = p.summary
    const name = s.key ? `${s.title} [${s.key}]` : s.title
    if (upToDate(s)) console.log(`  = ${name}: up to date${toPublish.includes(p) ? ', publishes its drafts' : ''}`)
    else console.log(`  ${blocked.includes(p) ? '!' : s.target ? '~' : '+'} ${name} ${describe(s)}`)
    if (!s.key) console.log(`      no key in pack.json; add "key" so renames don't break the match`)
    if (s.skipped.length) console.log(`      skips ${plural(s.skipped.length, 'entry', 'entries')}: ${s.skipped.slice(0, 3).join('; ')}${s.skipped.length > 3 ? '; …' : ''}`)
    if (s.edited.length) {
      console.log(`      ${plural(s.edited.length, 'entry was', 'entries were')} edited in the admin since the last push: ${s.edited.slice(0, 5).join(', ')}${s.edited.length > 5 ? ', …' : ''}`)
      console.log(flags.overwrite ? '      --overwrite: those edits will be replaced' : '      skipped; pull them with `pt libraries pull`, or push with --overwrite')
    }
  }
  if (!toWrite.length && !toPublish.length) {
    console.log(blocked.length ? '\nNothing to write until the admin edits are handled.' : '\nEverything is up to date.')
    if (failed || blocked.length) process.exitCode = 1
    return
  }
  const action = flags.publish ? 'write and publish' : 'write as drafts'
  if (!await confirm(`\n${toWrite.length + toPublish.length === 1 ? 'Apply this' : `Apply these ${toWrite.length + toPublish.length}`} to ${host(api)} (${action})?`, flags.yes)) {
    console.log('Nothing written.')
    return
  }
  for (const p of toWrite) {
    try {
      const res = await api.request<{ id: string, version: number | null }>('POST', '/api/pt/admin/libraries/import', form(p.bytes, {
        target: p.summary.target?.id ?? 'new',
        confirm: '1',
        ...(flags.publish ? { publish: '1' } : {}),
        ...(flags.overwrite ? { overwrite: '1' } : {})
      }))
      console.log(`✓ ${p.summary.title}: ${res.version ? `published v${res.version}` : 'saved as drafts'}`)
    } catch (err) {
      failed++
      console.error(`✗ ${p.summary.title}: ${(err as Error).message}`)
    }
  }
  for (const p of toPublish) {
    const res = await api.request<{ version: number }>('POST', `/api/pt/admin/libraries/${p.summary.target!.id}/publish`)
    console.log(`✓ ${p.summary.title}: published v${res.version}`)
  }
  if (!flags.publish && toWrite.length) console.log(`\nDrafts only. Check them in the admin, then: pt libraries publish <key>${api.profileName === 'local' ? '' : ' --profile ' + api.profileName}`)
  if (failed || blocked.length) process.exitCode = 1
}

export async function pull(api: Api, ref: string, dirArg: string | undefined, flags: Flags): Promise<void> {
  const res = await api.request<{ pack: { key: string | null, title: string, entries: unknown[] }, images: { path: string, url: string }[] }>('GET', `/api/pt/admin/libraries/${encodeURIComponent(ref)}/export`)
  const dir = resolve(dirArg ?? res.pack.key ?? ref)
  if (existsSync(dir) && !await confirm(`${dir} exists; replace its pack.json and images?`, flags.yes)) {
    console.log('Nothing written.')
    return
  }
  const images: { path: string, bytes: Uint8Array }[] = []
  for (const img of res.images) {
    const r = await fetch(img.url).catch(() => null)
    if (!r?.ok) throw new CliError(`Couldn't download ${img.url}.`)
    images.push({ path: img.path, bytes: new Uint8Array(await r.arrayBuffer()) })
  }
  writePackFolder(dir, res.pack, images)
  console.log(`✓ ${res.pack.title}: ${plural(res.pack.entries.length, 'entry', 'entries')} and ${plural(images.length, 'image')} in ${dir}`)
  if (!res.pack.key) console.log('  This library has no key yet; set "key" in pack.json and push to give it one.')
}

export async function publish(api: Api, ref: string, flags: Flags): Promise<void> {
  const { libraries } = await api.request<{ libraries: PlatformLibrary[] }>('GET', '/api/pt/admin/libraries/platform')
  const lib = libraries.find(l => l.id === ref || l.key === ref)
  if (!lib) throw new CliError(`No platform library "${ref}" on ${host(api)}.`)
  if (!lib.drafts) {
    console.log(`${lib.title} has no unpublished drafts.`)
    return
  }
  const usage = await api.request<{ following: Following[] }>('GET', `/api/pt/admin/libraries/${lib.id}/usage`)
  const reach = usage.following.length ? `; ${plural(usage.following.length, 'site follows', 'sites follow')} it and will show the new text` : ''
  if (!await confirm(`Publish ${plural(lib.drafts, 'draft')} of “${lib.title}” on ${host(api)}${reach}?`, flags.yes)) {
    console.log('Nothing published.')
    return
  }
  const res = await api.request<{ version: number }>('POST', `/api/pt/admin/libraries/${lib.id}/publish`)
  console.log(`✓ ${lib.title}: published v${res.version}`)
}

function printFollowing(following: Following[]): void {
  for (const f of following) console.log(`  ${f.site.name} (${f.site.slug})${f.campaigns.length ? `: ${f.campaigns.join(', ')}` : ''}`)
}

export async function remove(api: Api, ref: string, flags: Flags): Promise<void> {
  const usage = await api.request<{ library: { id: string, title: string }, following: Following[], copies: number }>('GET', `/api/pt/admin/libraries/${encodeURIComponent(ref)}/usage`)
  const { library, following } = usage
  if (following.length && !flags.detach) {
    console.log(`“${library.title}” is followed by ${plural(following.length, 'site')}; deleting it would empty their prayer content:`)
    printFollowing(following)
    console.log('\nRemove it from those campaigns first, or run again with --detach to give each site its own frozen copy.')
    process.exitCode = 1
    return
  }
  if (following.length) {
    console.log(following.length === 1 ? 'This site will keep a frozen copy of the published entries and stop getting updates:' : `These ${following.length} sites will each keep a frozen copy of the published entries and stop getting updates:`)
    printFollowing(following)
  }
  if (!await confirm(`Delete “${library.title}” from ${host(api)}? This can't be undone.`, flags.yes)) {
    console.log('Nothing deleted.')
    return
  }
  try {
    const res = await api.request<{ detached: number }>('DELETE', `/api/pt/admin/libraries/${library.id}${flags.detach ? '?detach=1' : ''}`)
    console.log(`✓ Deleted “${library.title}”${res.detached ? `; ${plural(res.detached, 'site keeps', 'sites keep')} a frozen copy` : ''}`)
  } catch (err) {
    const following = (err as ApiError).data?.following as Following[] | undefined
    if (following) {
      console.error(`${(err as Error).message}`)
      printFollowing(following)
      process.exitCode = 1
      return
    }
    throw err
  }
}
