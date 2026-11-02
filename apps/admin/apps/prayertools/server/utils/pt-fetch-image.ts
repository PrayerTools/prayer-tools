// Downloads an image from a URL a champion (or their AI client) supplies.
// Like core's safeFetch, the address check runs inside the socket's own DNS
// lookup, so a host can't resolve public for the check and private for the
// connect; redirects are followed by hand and each target is checked; the
// body is cut off at a byte cap. safeFetch returns text, so this reads bytes.
import { lookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { isPublicAddress } from '#core/server/utils/safe-fetch'

const MAX_REDIRECTS = 3
const TIMEOUT_MS = 15_000
const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|avif|heic|heif)$/

function blocked(message: string): never {
  ptBadRequest(`Could not fetch the image: ${message}`)
}

const checkedLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true, verbatim: true }).then(
    (all) => {
      const wanted = options.family === 4 || options.family === 6 ? all.filter(a => a.family === options.family) : all
      if (!all.length || !all.every(a => isPublicAddress(a.address)) || !wanted.length) {
        callback(Object.assign(new Error(`${hostname} is not a public address`), { code: 'PT_BLOCKED' }), '', 0)
      } else if (options.all) {
        callback(null, wanted)
      } else {
        callback(null, wanted[0]!.address, wanted[0]!.family)
      }
    },
    () => callback(Object.assign(new Error(`Could not resolve ${hostname}`), { code: 'PT_BLOCKED' }), '', 0)
  )
}

function get(u: URL, signal: AbortSignal): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = (u.protocol === 'https:' ? https : http).request(u, {
      method: 'GET',
      headers: { 'accept': 'image/*', 'user-agent': 'Prayer.Tools image import' },
      lookup: checkedLookup,
      // A fresh socket per request: a pooled one would skip the lookup.
      agent: false,
      signal
    }, resolve)
    req.on('error', reject)
    req.end()
  })
}

export async function ptFetchImage(url: string, maxBytes: number): Promise<{ data: Buffer, contentType: string }> {
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  let current: URL
  try {
    current = new URL(url)
  } catch {
    blocked('that is not a URL.')
  }
  for (let hop = 0; ; hop++) {
    if (current.protocol !== 'https:' && current.protocol !== 'http:') blocked('only http(s) URLs can be fetched.')
    const host = current.hostname.replace(/^\[|\]$/g, '')
    if (isIP(host) && !isPublicAddress(host)) blocked(`${host} is not a public address.`)
    let res: http.IncomingMessage
    try {
      res = await get(current, signal)
    } catch (err) {
      const e = err as { code?: string, message?: string }
      blocked(e.code === 'PT_BLOCKED' ? `${e.message}.` : 'the server did not answer.')
    }
    const status = res.statusCode ?? 0
    if (status >= 300 && status < 400 && res.headers.location) {
      res.destroy()
      if (hop >= MAX_REDIRECTS) blocked('too many redirects.')
      current = new URL(res.headers.location, current)
      continue
    }
    const contentType = String(res.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
    if (status !== 200) {
      res.destroy()
      blocked(`the server answered ${status}.`)
    }
    if (!IMAGE_TYPES.test(contentType)) {
      res.destroy()
      blocked('it is not a JPEG, PNG, WebP, GIF or AVIF image.')
    }
    if (Number(res.headers['content-length']) > maxBytes) {
      res.destroy()
      blocked(`images can be up to ${Math.round(maxBytes / 1024 / 1024)} MB.`)
    }
    const parts: Buffer[] = []
    let total = 0
    try {
      for await (const chunk of res) {
        total += (chunk as Buffer).byteLength
        if (total > maxBytes) blocked(`images can be up to ${Math.round(maxBytes / 1024 / 1024)} MB.`)
        parts.push(chunk as Buffer)
      }
    } finally {
      res.destroy()
    }
    return { data: Buffer.concat(parts), contentType }
  }
}
