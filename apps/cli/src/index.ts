#!/usr/bin/env bun
// The prayer.tools CLI: manages platform libraries through the admin app's
// operator routes, signed in through the browser.
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { Api, CliError, login, logout } from './auth'
import { list, publish, pull, push, remove, type Flags } from './libraries'
import { unzipPack } from './packs'

const HELP = `prayer.tools CLI

  pt login [profile] [url]          sign in through the browser (profile "local" is ${'http://localhost:3030'})
      --no-browser                  print the sign-in link instead of opening it
  pt logout [profile]               forget the profile's tokens

  pt libraries list                 platform libraries, their keys and unpublished drafts
  pt libraries push <pack|folder>…  preview, confirm, then write packs as drafts
      --publish                     publish what was written
      --overwrite                   replace entries edited in the admin since the last push
  pt libraries pull <key> [dir]     write a library's drafts and images as a pack folder
  pt libraries publish <key>        publish a library's drafts
  pt libraries delete <key>         delete a library no site follows
      --detach                      first give each following site a frozen copy

  pt packs unzip <pack.zip> [dir]   turn a pack zip into a pack folder

Every command talks to the "local" profile unless given --prod (the "prod"
profile) or --profile <name>. --yes answers confirmations.`

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      prod: { type: 'boolean' },
      profile: { type: 'string' },
      yes: { type: 'boolean', short: 'y' },
      publish: { type: 'boolean' },
      overwrite: { type: 'boolean' },
      detach: { type: 'boolean' },
      'no-browser': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    }
  })
  const [group, command, ...rest] = positionals
  if (values.help || !group) {
    console.log(HELP)
    return
  }
  const profile = values.profile ?? (values.prod ? 'prod' : 'local')
  const flags: Flags = { yes: !!values.yes, publish: !!values.publish, overwrite: !!values.overwrite, detach: !!values.detach }

  if (group === 'login') {
    const name = values.profile ?? (values.prod ? 'prod' : command ?? 'local')
    const p = await login(name, values.profile || values.prod ? command : rest[0], { browser: !values['no-browser'] })
    const api = new Api(name, p)
    await api.request('GET', '/api/pt/admin/libraries/platform')
    console.log(`✓ Signed in to ${p.url} as profile "${name}", with operator access.`)
    return
  }
  if (group === 'logout') {
    const name = values.profile ?? (values.prod ? 'prod' : command ?? 'local')
    const p = logout(name)
    console.log(p ? `Signed out of "${name}" (${p.url}). To revoke the connection on the server, remove "prayer.tools CLI" under Connected apps.` : `No profile "${name}".`)
    return
  }
  if (group === 'packs' && command === 'unzip') {
    const [zip, dir] = rest
    if (!zip) throw new CliError('Usage: pt packs unzip <pack.zip> [dir]')
    const target = resolve(dir ?? zip.replace(/\.zip$/i, ''))
    const res = unzipPack(zip, target)
    console.log(`✓ ${target}: ${res.entries} entries, ${res.images} images`)
    return
  }
  if (group === 'libraries') {
    const api = Api.for(profile)
    const need = (arg: string | undefined, usage: string) => {
      if (!arg) throw new CliError(`Usage: pt libraries ${usage}`)
      return arg
    }
    switch (command) {
      case 'list': return await list(api)
      case 'push': return await push(api, rest.length ? rest : [need(undefined, 'push <pack|folder>…')], flags)
      case 'pull': return await pull(api, need(rest[0], 'pull <key> [dir]'), rest[1], flags)
      case 'publish': return await publish(api, need(rest[0], 'publish <key>'), flags)
      case 'delete': return await remove(api, need(rest[0], 'delete <key> [--detach]'), flags)
    }
  }
  throw new CliError(`Unknown command. Run pt --help.`)
}

main().catch((err) => {
  console.error(err instanceof CliError ? err.message : err)
  process.exit(1)
})
