// Acceptance checks after an import (staging rehearsal or cutover): for each
// site, sample its pages and old WordPress links on the running public server,
// load the files the pages use, and compare counts with WordPress. Prints a
// PASS / FAIL line per site and writes `.data/wp-check-report.json` (`-partial.json` with --blogs).
//
// Usage: DATABASE_URL=… WP_DATABASE_URL=mysql://… PT_SITE_BASE_HOST=… bun run scripts/wp-import/check.ts
//   [--blogs 32,92]   only these subsites
//   [--sample 2]      pages and links to try per site
//   [--no-aliases]    skip the old-address redirects, while the old addresses
//                     still point at WordPress (staging rehearsals)
// CHECK_ORIGIN=http://127.0.0.1:3041 sends every request there with the site's
// Host header (local runs); without it requests go to each site's own address.
import { parseArgs } from 'node:util'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDb } from '@prayertools/shared/db/connect'
import { hashToken } from '@prayertools/shared/tokens'
import { normalizeEmail } from '@prayertools/shared/crm'
import { campaignLength } from '@prayertools/shared/setup'
import { entryNumber } from '@prayertools/shared/schedule'
import { todayIn } from '@prayertools/shared/dates'
import { connectWp, first, languageOf, metaOf, networkTable, postsOf, table, tableExists } from './wp'
import { parseMessage } from './messages'

const { values: args } = parseArgs({ options: { 'blogs': { type: 'string' }, 'sample': { type: 'string' }, 'no-aliases': { type: 'boolean' } } })
const sample = Number(args.sample ?? 2) || 2
const db = createDb(process.env.DATABASE_URL!)
const wp = connectWp()
const baseHost = process.env.PT_SITE_BASE_HOST?.toLowerCase()
if (!process.env.DATABASE_URL || !baseHost) throw new Error('DATABASE_URL and PT_SITE_BASE_HOST are required')
const origin = process.env.CHECK_ORIGIN?.replace(/\/$/, '') ?? null
const siteAddress = (slug: string) => `${baseHost.startsWith('localhost') ? 'http' : 'https'}://${slug}.${baseHost}`
const storageBases = [process.env.NUXT_PUBLIC_SITE_URL, process.env.S3_PUBLIC_BASE_URL].filter(Boolean).map(u => u!.replace(/\/$/, ''))
const OLD_SERVER = /https?:\/\/(?:[a-z0-9-]+\.(?:prayer\.tools|pray4movement\.org)|ramadan\.(?:prayforniger\.org|praymorocco\.com))\/wp-content\//i

interface Check { name: string, ok: boolean, detail?: string }

// A request to a site URL, through CHECK_ORIGIN with its Host header when set.
async function get(url: string): Promise<Response> {
  const u = new URL(url)
  const target = origin ? `${origin}${u.pathname}${u.search}` : url
  return await fetch(target, { redirect: 'manual', headers: origin ? { host: u.host } : {} })
}
const location = (r: Response) => r.headers.get('location') ?? ''

async function checkSite(orgId: string, slug: string, wpBlog: { blog_id: number, domain: string, archived: number, deleted: number }, alias: string | null): Promise<Check[]> {
  const checks: Check[] = []
  const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, ...(detail ? { detail } : {}) })
  const blogId = Number(wpBlog.blog_id)
  const site = await db.selectFrom('pt_site').select(['status', 'languages', 'default_language']).where('org_id', '=', orgId).executeTakeFirstOrThrow()
  const base = siteAddress(slug)
  const archived = site.status === 'archived'

  const home = await get(`${base}/`)
  add('home page', home.status === 200, `status ${home.status}`)

  const campaigns = await db.selectFrom('pt_campaign').select(['id', 'slug', 'name']).where('org_id', '=', orgId).where('published_at', 'is not', null).orderBy('start_date', 'desc').execute()
  for (const c of campaigns.slice(0, sample)) {
    const r = await get(`${base}/${c.slug}`)
    add(`campaign /${c.slug}`, r.status === 200, `status ${r.status}`)
  }

  // Prayer content: the page shows the entry, its title is a WordPress post
  // title for that day and language, and its files load from v3's storage.
  if (!archived) {
    const entries = await db.selectFrom('pt_site_entry as e')
      .innerJoin('pt_campaign_library as cl', 'cl.site_library_id', 'e.site_library_id')
      .innerJoin('pt_campaign as c', 'c.id', 'cl.campaign_id')
      .select(['c.slug', 'c.start_mode', 'c.start_date', 'c.end_mode', 'c.end_date', 'c.length_days', 'c.cadence', 'c.timezone', 'e.day', 'e.language', 'e.content'])
      .where('e.org_id', '=', orgId).orderBy('c.start_date', 'desc').orderBy('e.day').execute()
    // v3 shows a day from its date up to the campaign's last day; days past
    // the end are imported but not shown, and the import report lists them.
    const shown = entries.filter((e) => {
      const length = campaignLength(e as never)
      const today = e.start_mode === 'date' && e.start_date ? entryNumber(e.start_date, e.cadence, todayIn(e.timezone)) : Infinity
      return (length === null || e.day <= length) && e.day <= today
    })
    const picks = shown.length <= sample ? shown : Array.from({ length: sample }, (_, i) => shown[Math.floor(i * (shown.length - 1) / Math.max(1, sample - 1))]!)
    const wpTitles = new Set<string>()
    if (picks.length) {
      const fuel = (await postsOf(wp, blogId, 'landing')).filter(p => p.post_status === 'publish' || p.post_status === 'future')
      const fmeta = await metaOf(wp, blogId, fuel.map(p => p.ID))
      // A post without a title shows the content's own first heading.
      for (const p of fuel) wpTitles.add(`${first(fmeta.get(p.ID), 'day')}|${languageOf(first(fmeta.get(p.ID), 'post_language') ?? 'en_US')}|${p.post_title.replace(/\s+/g, ' ').trim()}`)
    }
    for (const e of picks) {
      const prefix = e.language !== site.default_language ? `/${e.language}` : ''
      const url = `${base}${prefix}/${e.slug}/pray/${e.day}`
      const r = await get(url)
      const html = r.status === 200 ? await r.text() : ''
      const heading = ((e.content as { content?: { type: string, content?: { text?: string }[] }[] }).content ?? []).find(n => n.type === 'heading')?.content?.map(t => t.text ?? '').join('').trim() ?? ''
      const plainHtml = html.replace(/&#0?39;/g, '\'').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      add(`fuel ${prefix}/${e.slug}/pray/${e.day}`, r.status === 200 && (!heading || plainHtml.includes(heading)), r.status === 200 ? (heading && !plainHtml.includes(heading) ? `title "${heading.slice(0, 60)}" not on the page` : undefined) : `status ${r.status}`)
      if (heading) add(`fuel title matches WordPress, day ${e.day} ${e.language}`, wpTitles.has(`${e.day}|${e.language}|${heading}`) || wpTitles.has(`${e.day}|${e.language}|`), heading.slice(0, 60))
      if (OLD_SERVER.test(html)) add(`no WordPress files on /${e.slug}/pray/${e.day}`, false, html.match(OLD_SERVER)?.[0])
      const files = [...new Set([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]!).filter(u => storageBases.some(b => u.startsWith(b))))]
      for (const f of files.slice(0, 6)) {
        const fr = await fetch(f, { method: 'GET' })
        add(`file ${f.split('/').pop()}`, fr.ok, `status ${fr.status}`)
        await fr.body?.cancel()
      }
    }
  }

  // Old WordPress links.
  const subs = await postsOf(wp, blogId, 'subscriptions')
  const smeta = await metaOf(wp, blogId, subs.map(s => s.ID))
  let tried = 0
  for (const s of subs) {
    if (tried >= sample) break
    const m = smeta.get(s.ID)
    const manage = first(m, 'subscriptions_app_manage_magic_key')
    const fuelKey = first(m, 'prayer_fuel_magic_key')
    if (!manage || (first(m, 'status') ?? 'active') !== 'active') continue
    const known = await db.selectFrom('pt_legacy_key').select('id').where('kind', '=', 'manage').where('key_hash', '=', hashToken(manage)).executeTakeFirst()
    if (!known) continue
    tried++
    const r = await get(`${base}/subscriptions_app/manage/${manage}`)
    add('old manage link', r.status === 302 && location(r).endsWith('/manage'), `${r.status} → ${location(r).replace(/[0-9a-f]{20,}/g, '…')}`)
    if (fuelKey) {
      const f = await get(`${base}/prayer/fuel/${fuelKey}`)
      add('old personal fuel link', f.status === 302 && location(f).includes('/pray#p='), `${f.status}`)
    }
    if (alias && !args['no-aliases']) {
      const a = await get(`http://${alias}/subscriptions_app/manage/${manage}?x=1`)
      add('old address redirects', a.status === 301 && location(a) === `${base}/subscriptions_app/manage/${manage}?x=1`, `${a.status} → ${location(a).replace(/[0-9a-f]{20,}/g, '…')}`)
    }
  }
  const bogus = await get(`${base}/subscriptions_app/manage/not-a-real-key`)
  add('unknown manage key is refused', bogus.status === 404, `status ${bogus.status}`)

  // Old page addresses.
  const current = campaigns[0]
  if (current && !archived) {
    const list = await get(`${base}/${current.slug}/list`)
    add('/list redirects', list.status === 301 && location(list).endsWith(`/${current.slug}/pray`), `${list.status} → ${location(list)}`)
    const contact = await get(`${base}/${current.slug}/contact-us`)
    add('/contact-us redirects', contact.status === 301 && location(contact).endsWith(`/${current.slug}/contact`), `${contact.status} → ${location(contact)}`)
    const other = site.languages.find(l => l !== site.default_language)
    if (other) {
      const r = await get(`${base}/${current.slug}/fuel/1?lang=${other}_XX`)
      add('?lang picks the language', r.status === 301 && location(r).endsWith(`/${other}/${current.slug}/pray/1`), `${r.status} → ${location(r)}`)
    }
  }

  // Counts against WordPress.
  const confirmed = new Set<string>()
  for (const s of subs) {
    const m = smeta.get(s.ID)
    if ((first(m, 'status') ?? 'active') === 'pending') continue
    for (const [k, v] of m ?? []) {
      if (!/^contact_email(_[0-9a-z]+)?$/.test(k) || !v[0]) continue
      const { normalized, valid } = normalizeEmail(v[0])
      if (valid) confirmed.add(normalized)
      break
    }
  }
  const [v3Subs] = await db.selectFrom('pt_subscription').select(eb => eb.fn.countAll<string>().as('n')).where('org_id', '=', orgId).where('verified_at', 'is not', null).execute()
  add('confirmed subscribers match WordPress', Number(v3Subs?.n ?? 0) === confirmed.size, `WordPress ${confirmed.size}, v3 ${v3Subs?.n}`)

  const wpCampaignIds = new Set((await postsOf(wp, blogId, 'campaigns')).map(c => c.ID))
  const fuel = (await postsOf(wp, blogId, 'landing')).filter(p => p.post_status === 'publish' || p.post_status === 'future')
  const fmeta = await metaOf(wp, blogId, fuel.map(p => p.ID))
  const days = new Set<string>()
  for (const p of fuel) {
    const m = fmeta.get(p.ID)
    const linked = Number(first(m, 'linked_campaign')) || 0
    const day = Number(first(m, 'day')) || 0
    if (linked && day > 0 && wpCampaignIds.has(linked)) days.add(`${linked}|${day}|${languageOf(first(m, 'post_language') ?? 'en_US')}`)
  }
  const [v3Entries] = await db.selectFrom('pt_site_entry').select(eb => eb.fn.countAll<string>().as('n')).where('org_id', '=', orgId).execute()
  add('prayer content days match WordPress', Number(v3Entries?.n ?? 0) === days.size, `WordPress ${days.size}, v3 ${v3Entries?.n}`)

  if (await tableExists(wp, table(blogId, 'comments'))) {
    // Stories in a format the importer doesn't know, or whose address can't be found, aren't imported.
    const rows = await wp.unsafe(`SELECT c.comment_content x FROM ${table(blogId, 'comments')} c JOIN ${table(blogId, 'posts')} p ON p.ID = c.comment_post_ID WHERE p.post_type = 'campaigns' AND c.comment_type = 'stories'`) as { x: string }[]
    const parsed = rows.map(r => parseMessage('stories', r.x)).filter(Boolean)
    const sure = parsed.filter(m => m!.valid).length
    const [v3Stories] = await db.selectFrom('pt_story').select(eb => eb.fn.countAll<string>().as('n')).where('org_id', '=', orgId).execute()
    const n = Number(v3Stories?.n ?? 0)
    add('stories match WordPress', n >= sure && n <= parsed.length, `WordPress ${rows.length} (${sure} with a full address), v3 ${n}`)
  }

  // Reminders only where they belong.
  const [stray] = await db.selectFrom('pt_commitment as k')
    .innerJoin('pt_campaign as c', 'c.id', 'k.campaign_id')
    .innerJoin('pt_subscription as s', 's.id', 'k.subscription_id')
    .select(eb => eb.fn.countAll<string>().as('n'))
    .where('k.org_id', '=', orgId)
    .where('k.next_reminder_utc', 'is not', null)
    .where(eb => eb.or([eb('c.ended_at', 'is not', null), eb('k.paused', '=', true), eb('s.verified_at', 'is', null), eb('s.status', '<>', 'active')]))
    .execute()
  add('no reminders for ended, paused or unconfirmed', Number(stray?.n ?? 0) === 0, `${stray?.n} would be sent`)
  return checks
}

const blogs = (await wp.unsafe(`SELECT blog_id, domain, archived, deleted, spam FROM ${networkTable('blogs')} ORDER BY blog_id`) as { blog_id: number, domain: string, archived: number, deleted: number, spam: number }[])
  .filter(b => !args.blogs || args.blogs.split(',').map(Number).includes(Number(b.blog_id)))
const aliases = new Map((await db.selectFrom('pt_site_alias').select(['hostname', 'org_id']).execute()).map(a => [a.hostname, a.org_id]))
const orgs = await db.selectFrom('orgs').select(['id', 'slug']).execute()
const bySlugHost = new Map(orgs.map(o => [`${o.slug}.${baseHost}`, o]))
const byId = new Map(orgs.map(o => [o.id, o]))

const results: { blogId: number, domain: string, slug: string | null, ok: boolean, checks: Check[] }[] = []
for (const b of blogs) {
  const domain = b.domain.toLowerCase()
  const org = aliases.has(domain) ? byId.get(aliases.get(domain)!) : bySlugHost.get(domain)
  if (!org) {
    results.push({ blogId: Number(b.blog_id), domain, slug: null, ok: Number(b.spam) === 1, checks: [{ name: 'site imported', ok: Number(b.spam) === 1, detail: 'no v3 site for this subsite' }] })
    console.log(`FAIL ${String(b.blog_id).padStart(4)} ${domain}: no v3 site`)
    continue
  }
  try {
    const checks = await checkSite(org.id, org.slug, b, aliases.has(domain) ? domain : null)
    const failed = checks.filter(c => !c.ok)
    results.push({ blogId: Number(b.blog_id), domain, slug: org.slug, ok: !failed.length, checks })
    console.log(`${failed.length ? 'FAIL' : 'PASS'} ${String(b.blog_id).padStart(4)} ${org.slug.padEnd(32)} ${checks.length - failed.length}/${checks.length}${failed.length ? `  ${failed.map(f => `${f.name}${f.detail ? ` (${f.detail})` : ''}`).join('; ')}` : ''}`)
  } catch (err) {
    results.push({ blogId: Number(b.blog_id), domain, slug: org.slug, ok: false, checks: [{ name: 'checks ran', ok: false, detail: err instanceof Error ? err.message : String(err) }] })
    console.log(`FAIL ${String(b.blog_id).padStart(4)} ${org.slug}: ${err instanceof Error ? err.message : err}`)
  }
}

const failedSites = results.filter(r => !r.ok)
console.log(`\n${results.length - failedSites.length}/${results.length} sites pass`)
const dir = join(import.meta.dir, '..', '..', '.data')
await mkdir(dir, { recursive: true })
await writeFile(join(dir, args.blogs ? 'wp-check-report-partial.json' : 'wp-check-report.json'), JSON.stringify({ at: new Date().toISOString(), passed: results.length - failedSites.length, failed: failedSites.length, sites: results }, null, 2))
console.log(`Report: ${join(dir, args.blogs ? 'wp-check-report-partial.json' : 'wp-check-report.json')}`)
await wp.close()
await db.destroy()
process.exit(failedSites.length ? 1 : 0)
