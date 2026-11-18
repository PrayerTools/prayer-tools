import { downloadTemplate } from 'giget'
import { LAYERS } from '../layers'
import { sourceOf } from './lib/resolve'
import { readLock, resolveAll, writeLock } from './lib/lock'

// Fetch each selected layer into _layers/<id>/.
//
// Resolution (a range / 'latest' -> a concrete tag) is NOT done here — that's
// layers:update's job, and it records the result in layers.lock.json. This step
// just reads the lock and fetches the exact ref it pins, like `npm ci`, so a
// build is reproducible. On a first run with no lock (e.g. a fresh `bun run
// setup`), resolve once and write it so setup still works unattended — with no
// tags in the source yet, every layer resolves to `master`, i.e. today's behaviour.
//
// `--only <id>` fetches one layer at its locked ref and never resolves: the
// worker and public images use it to fetch the mail kernel alone.

if (process.env.NUXTINATOR_SOURCE_DIR) {
  console.log(`NUXTINATOR_SOURCE_DIR is set — layers load from ${process.env.NUXTINATOR_SOURCE_DIR}, nothing to fetch.`)
  process.exit(0)
}

const onlyAt = process.argv.indexOf('--only')
const only = onlyAt >= 0 ? process.argv[onlyAt + 1] : null
if (onlyAt >= 0 && (!only || !LAYERS.some(l => l.id === only))) {
  console.error(`--only needs a layer id from layers.ts (${LAYERS.map(l => l.id).join(', ')})`)
  process.exit(1)
}

let lock = readLock()
if (only && !lock?.[only]) {
  console.error(`layers.lock.json has no entry for ${only}: run 'bun run layers:update' and commit the lock`)
  process.exit(1)
}
if (!lock) {
  console.log('No layers.lock.json — resolving once from layers.ts…')
  lock = resolveAll(LAYERS, process.env.LAYER_SOURCE_TOKEN).lock
  writeLock(lock)
}

const selected = only ? LAYERS.filter(l => l.id === only) : LAYERS
for (const l of selected) {
  const ref = lock[l.id]?.ref ?? 'master'
  const url = `${sourceOf(l)}#${ref}`
  console.log(`Fetching ${l.id} @ ${ref}`)
  await downloadTemplate(url, { dir: `_layers/${l.id}`, forceClean: true })
}

console.log(`\nFetched ${selected.length} layer${selected.length === 1 ? '' : 's'}. Run 'bun install' to hoist their deps via workspaces.`)
