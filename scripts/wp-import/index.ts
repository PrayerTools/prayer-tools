// Imports the WordPress prayer campaigns network (one subsite per champion)
// into v3: each subsite becomes a site with its campaigns, team, subscribers,
// prayer times, legacy link keys and prayer content. Writes a report comparing
// the two systems to `.data/wp-import-report.json` (`-partial.json` with --blogs).
//
// Usage: DATABASE_URL=… APP_DATABASE_URL=… PT_SITE_BASE_HOST=… WP_DATABASE_URL=mysql://… bun run scripts/wp-import/index.ts
//   [--blogs 32,92]   only these subsites
//   [--replace]       delete and re-import sites that already exist (otherwise they're skipped)
//   [--no-content]    skip prayer content
//   [--send-confirmations]  queue a new confirmation email for recent unconfirmed signups (needs MAIL_OUTBOX_PUBLIC_KEY and PT_SECRET)
// WP_UPLOADS_DIR / WP_PLUGINS_DIR: the backup's wp-content/uploads/sites and wp-content/plugins (default .data/wp-uploads, .data/wp-plugins)
import { parseArgs } from 'node:util'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDb } from '@prayertools/shared/db/connect'
import { withOrg } from '@prayertools/shared/db/scope'
import { jsonb, pgArray } from '@prayertools/shared/db/json'
import { ensureSystemUser } from '@prayertools/shared/crm'
import { createPtMail, providePtMail } from '@prayertools/shared/email/mail'
import { ensureAccount } from '@prayertools/shared/accounts'
import { enableSiteApps } from '@prayertools/shared/site'
import { slugError } from '@prayertools/shared/config'
import { isLanguage } from '@prayertools/shared/languages'
import type { CampaignRow } from '@prayertools/shared/subscriptions'
import type { CampaignBranding } from '@prayertools/shared/db/schema'
import { connectWp, languageOf, metaOf, networkTable, options, postsOf, table, tableExists, unserialize, wpDate, WP_PREFIX } from './wp'
import { campaignUse, emptyOverlaps, peopleGroupsOf, placesOf, planCampaigns, isStencil, siteColor } from './campaigns'
import { importSignupFields } from './signup-fields'
import { landingText, translationsOf, type LandingText } from './landing'
import { importMessages, type MessageCounts } from './messages'
import { importStats, loadPraying, type StatCounts } from './stats'
import { importContent, type ContentCounts } from './content'
import { createImageStore } from './images'
import { grantNews, importSubscribers, type NewsRequest, type SubscriberCounts } from './subscribers'

const { values: args } = parseArgs({
  options: { 'blogs': { type: 'string' }, 'replace': { type: 'boolean' }, 'no-content': { type: 'boolean' }, 'send-confirmations': { type: 'boolean' } }
})
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')
const appUrl = process.env.APP_DATABASE_URL
if (!appUrl) throw new Error('APP_DATABASE_URL is required')
const db = createDb(url)
// Site rows are written on the RLS role, so contacts and subscriptions are
// looked up inside their own site only, as on the public site.
const app = createDb(appUrl)
const wp = connectWp()
const now = new Date()
// Sites live at `<slug>.<base host>`; their WordPress addresses elsewhere become aliases.
const baseHost = process.env.PT_SITE_BASE_HOST?.toLowerCase() ?? null
await ensureSystemUser(db)
// Confirmation emails go to the mail outbox for the worker to send, as from the public server.
if (args['send-confirmations']) {
  if (!process.env.MAIL_OUTBOX_PUBLIC_KEY || !process.env.PT_SECRET) throw new Error('--send-confirmations needs MAIL_OUTBOX_PUBLIC_KEY and PT_SECRET (as the public server has them)')
  const mail = createPtMail({ db, outboxPublicKey: process.env.MAIL_OUTBOX_PUBLIC_KEY })
  providePtMail(async () => mail)
}

// Custom domains that served subsites on this server, besides their network subdomain.
const CUSTOM_DOMAINS: Record<number, string[]> = {
  32: ['ramadan.prayforniger.org'],
  34: ['ramadan.praymorocco.com']
}
// Hosts whose prayer sessions count for a subsite: its domains, and the
// champion's own site that showed the same prayer counter.
const PRAYING_HOSTS: Record<number, string[]> = {
  32: ['prayforniger.org', 'www.prayforniger.org'],
  34: ['praymorocco.com', 'www.praymorocco.com']
}
const praying = await loadPraying(wp)
const unknownKinds = new Map<string, number>()

const onlyBlogs = args.blogs ? new Set(args.blogs.split(',').map(Number)) : null
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, '\'').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')

// ── Network ────────────────────────────────────────────────────────────────

interface Blog { blog_id: number, domain: string, registered: Date, last_updated: Date, archived: number, deleted: number, spam: number }
const blogs = (await wp.unsafe(`SELECT blog_id, domain, registered, last_updated, archived, deleted, spam FROM ${networkTable('blogs')} ORDER BY blog_id`) as Blog[])
  .map(b => ({ ...b, blog_id: Number(b.blog_id) }))

// prayer.tools keeps a subdomain's name; the same name on pray4movement.org gets `-p4m`.
const slugs = new Map<number, string>()
const labelUse = new Map<string, number>()
for (const b of [...blogs].sort((a, b) => Number(b.domain.endsWith('.prayer.tools')) - Number(a.domain.endsWith('.prayer.tools')) || a.blog_id - b.blog_id)) {
  const label = b.domain.split('.')[0]!.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 36)
  let slug = labelUse.has(label) ? `${label}-p4m` : label
  if (slugError(slug)) slug = `${label}-site`
  if (slugError(slug)) slug = `site-${b.blog_id}`
  labelUse.set(label, b.blog_id)
  slugs.set(b.blog_id, slug)
}

// Images and other files from the backup's wp-content: addresses on the
// network's subdomains (current or since renamed) and the custom domains are
// this server's; the main sites and object storage on the same domains aren't.
const dataDir = join(import.meta.dir, '..', '..', '.data')
const images = createImageStore({
  uploadsDir: process.env.WP_UPLOADS_DIR || join(dataDir, 'wp-uploads'),
  pluginsDir: process.env.WP_PLUGINS_DIR || join(dataDir, 'wp-plugins'),
  hosts: Object.values(CUSTOM_DOMAINS).flat(),
  excludeHosts: ['prayer.tools', 'www.prayer.tools', 'pray4movement.org', 'www.pray4movement.org', 's3.prayer.tools'],
  baseUrl: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3040'
})

interface WpUser { ID: number, user_login: string, user_email: string, display_name: string }
const users = new Map((await wp.unsafe(`SELECT ID, user_login, user_email, display_name FROM ${networkTable('users')}`) as WpUser[]).map(u => [Number(u.ID), u]))
const siteAdmins = new Set(Object.values((unserialize((await wp.unsafe(`SELECT meta_value FROM ${networkTable('sitemeta')} WHERE meta_key = 'site_admins'`) as { meta_value: string }[])[0]?.meta_value) ?? {}) as Record<string, string>))
const caps = await wp.unsafe(`SELECT user_id, meta_key, meta_value FROM ${networkTable('usermeta')} WHERE meta_key REGEXP ?`, [`^${WP_PREFIX}([0-9]+_)?capabilities$`]) as { user_id: number, meta_key: string, meta_value: string }[]
const rolesByBlog = new Map<number, { userId: number, roles: string[] }[]>()
for (const c of caps) {
  const match = c.meta_key.slice(WP_PREFIX.length).match(/^(\d+)_/)
  const blogId = match ? Number(match[1]) : 1
  const roles = Object.entries((unserialize(c.meta_value) ?? {}) as Record<string, boolean>).filter(([, on]) => on).map(([r]) => r)
  if (!roles.length) continue
  rolesByBlog.set(blogId, [...(rolesByBlog.get(blogId) ?? []), { userId: Number(c.user_id), roles }])
}

const ADMIN_ROLES = new Set(['administrator', 'dt_admin', 'campaigns_admin', 'porch_admin'])
function siteRoles(wpRoles: string[]): string[] {
  if (wpRoles.some(r => ADMIN_ROLES.has(r))) return ['admin']
  if (wpRoles.includes('marketer')) return ['pt-mobilizer']
  return ['pt-editor']
}

// Accounts for the network's people: operators (WordPress super admins) and
// site teams. They're verified, since WordPress had their addresses.
const accountOf = new Map<number, string>()
async function account(userId: number): Promise<string | null> {
  if (accountOf.has(userId)) return accountOf.get(userId)!
  const u = users.get(userId)
  if (!u?.user_email) return null
  const a = await ensureAccount(db, u.user_email)
  await db.updateTable('users').set({
    verified: true,
    ...(siteAdmins.has(u.user_login) ? { is_admin: true } : {}),
    ...(!a.display_name && u.display_name ? { display_name: decode(u.display_name).slice(0, 200) } : {})
  }).where('id', '=', a.id).execute()
  accountOf.set(userId, a.id)
  return a.id
}
for (const [id, u] of users) if (siteAdmins.has(u.user_login)) await account(id)

// ── Sites ──────────────────────────────────────────────────────────────────

interface SiteReport {
  blogId: number
  domain: string
  slug: string
  result: 'imported' | 'exists' | 'skipped'
  status?: string
  campaigns?: number
  sideCampaigns?: number
  team?: number
  subscribers?: SubscriberCounts
  content?: ContentCounts
  messages?: MessageCounts
  stats?: StatCounts
  directory?: boolean
  signupFields?: number
  peopleGroups?: boolean
  alias?: string
  wp?: { subscriptions: number, recurringRules: number, ruleTimes: number, pickedTimes: number }
  warnings: string[]
}
const report: SiteReport[] = []
const news: NewsRequest[] = []

async function importBlog(b: typeof blogs[number]): Promise<SiteReport> {
  const slug = slugs.get(b.blog_id)!
  const out: SiteReport = { blogId: b.blog_id, domain: b.domain, slug, result: 'imported', warnings: [] }
  if (Number(b.spam) === 1) return { ...out, result: 'skipped', warnings: ['marked as spam'] }
  const existing = await db.selectFrom('orgs').select('id').where('slug', '=', slug).executeTakeFirst()
  if (existing && !args.replace) return { ...out, result: 'exists' }
  if (existing) await db.deleteFrom('orgs').where('id', '=', existing.id).execute()

  const opts = await options(wp, b.blog_id, ['blogname', 'WPLANG'])
  const posts = await postsOf(wp, b.blog_id, 'campaigns')
  const meta = await metaOf(wp, b.blog_id, posts.map(p => p.ID))
  const selected = Number((await options(wp, b.blog_id, ['dt_campaign_selected_campaign'])).get('dt_campaign_selected_campaign')) || 0
  const skippedCampaigns = emptyOverlaps(planCampaigns(posts, meta, now, b.domain), await campaignUse(wp, b.blog_id), selected)
  const kept = posts.filter(p => !skippedCampaigns.has(p.ID))
  for (const p of posts) if (skippedCampaigns.has(p.ID)) out.warnings.push(`${p.post_title}: empty and overlaps another open-ended campaign; not imported`)
  const plans = planCampaigns(kept, meta, now, b.domain)
  const places = await placesOf(wp, b.blog_id, meta)
  const peopleGroups = await peopleGroupsOf(wp, b.blog_id)
  const translations = await translationsOf(wp, b.blog_id)
  const siteSettings = unserialize((await options(wp, b.blog_id, ['dt_prayer_campaign_settings'])).get('dt_prayer_campaign_settings')) as Record<string, unknown> | null
  const listed = !(siteSettings && typeof siteSettings === 'object' && siteSettings.p4m_participation === false)
  for (const p of plans) out.warnings.push(...p.warnings.map(w => `${p.slug}: ${w}`))

  const wanted = [...new Set([...plans.map(p => p.defaultLanguage).filter(Boolean) as string[], ...plans.flatMap(p => p.languages)])]
  const unsupported = wanted.filter(l => !isLanguage(l))
  if (unsupported.length) out.warnings.push(`languages not in v3: ${unsupported.join(', ')}`)
  const languages = wanted.filter(isLanguage)
  const siteDefault = languageOf(opts.get('WPLANG') || 'en_US')
  if (!languages.length) languages.push(isLanguage(siteDefault) ? siteDefault : 'en')
  const latest = [...plans].filter(p => !p.kind).sort((x, y) => y.startDate.localeCompare(x.startDate))[0]
  const defaultLanguage = latest?.defaultLanguage && languages.includes(latest.defaultLanguage) ? latest.defaultLanguage : languages[0]!
  const archived = Number(b.archived) === 1 || Number(b.deleted) === 1
  const registered = wpDate(b.registered)
  const texts = new Map<number, LandingText>()
  for (const p of plans) {
    texts.set(p.wpId, await landingText(meta.get(p.wpId), translations.get(p.wpId), {
      defaultLanguage: p.defaultLanguage && languages.includes(p.defaultLanguage) ? p.defaultLanguage : defaultLanguage,
      languages,
      ramadan: p.templateKey === 'ramadan',
      campaignName: p.name,
      rewrite: doc => images.rewrite(doc),
      rewriteUrl: u => images.rewriteUrl(u)
    }))
  }
  // Each site-wide text, the sender and the logo come from the most recent
  // campaign that set it, main campaigns first.
  const recent = [...plans].sort((x, y) => Number(!!x.kind) - Number(!!y.kind) || y.startDate.localeCompare(x.startDate)).map(p => texts.get(p.wpId)!)
  const pick = <T>(f: (t: LandingText) => T | null | undefined): T | undefined => recent.map(f).find(v => v !== null && v !== undefined)
  const identity = {
    from_name: pick(t => t.emailIdentity.from_name),
    reply_to: pick(t => t.emailIdentity.reply_to),
    logo_url: pick(t => t.emailIdentity.logo_url),
    signature: pick(t => t.emailIdentity.signature)
  }
  const siteText = {
    description: latest ? texts.get(latest.wpId)!.description : null,
    emailIdentity: Object.fromEntries(Object.entries(identity).filter(([, v]) => v !== undefined)),
    siteLogoUrl: pick(t => t.siteLogoUrl) ?? null,
    siteStrings: [...new Set(recent.flatMap(t => t.siteStrings.map(r => r.key)))]
      .flatMap(key => recent.find(t => t.siteStrings.some(r => r.key === key))!.siteStrings.filter(r => r.key === key))
  }

  const org = await db.insertInto('orgs').values({
    slug, name: decode(opts.get('blogname') || slug).slice(0, 200), created_at: registered, updated_at: now
  }).returning('id').executeTakeFirstOrThrow()
  // The org is written outside the site transaction; a failed site leaves none behind.
  try {
    await enableSiteApps(db, org.id)
    // The WordPress address redirects to the site when it isn't the site's own.
    if (baseHost && b.domain.toLowerCase() !== `${slug}.${baseHost}`) {
      await db.insertInto('pt_site_alias').values({ hostname: b.domain.toLowerCase(), org_id: org.id }).onConflict(oc => oc.column('hostname').doNothing()).execute()
      out.alias = b.domain.toLowerCase()
    }
    const team = new Map<string, string[]>()
    for (const r of rolesByBlog.get(b.blog_id) ?? []) {
      const u = users.get(r.userId)
      if (!u) continue
      const userId = await account(r.userId)
      if (userId) team.set(userId, siteRoles(r.roles))
    }
    for (const [userId, roles] of team) {
      await db.insertInto('memberships').values({ user_id: userId, org_id: org.id, roles: pgArray(roles), created_at: registered, updated_at: now }).execute()
    }

    let heroUrl: string | null = null
    const color = siteColor(plans, selected)
    await withOrg(app, org.id, async (tx) => {
      await tx.insertInto('pt_site').values({
        org_id: org.id,
        status: archived ? 'archived' : 'published',
        languages: pgArray(languages),
        default_language: defaultLanguage,
        timezone: latest?.timezone ?? 'UTC',
        branding: jsonb({
          ...(color ? { color } : {}),
          ...(siteText?.siteLogoUrl ? { logo_url: siteText.siteLogoUrl } : {})
        }),
        email_identity: jsonb(siteText?.emailIdentity ?? {}),
        onboarding: jsonb({ completed: true }),
        published_at: registered,
        archived_at: archived ? wpDate(b.last_updated) : null,
        created_at: registered,
        updated_at: now
      }).execute()

      const campaigns = new Map<number, CampaignRow>()
      for (const p of plans) {
        const text = texts.get(p.wpId)!
        const place = places.get(p.wpId)
        const row = await tx.insertInto('pt_campaign').values({
          slug: p.slug, name: p.name, template_key: p.templateKey, kind: p.kind,
          place_name: place?.name ?? text.placeName, people_group: text.peopleGroup ?? peopleGroups, latitude: place?.latitude ?? null, longitude: place?.longitude ?? null,
          start_mode: 'date', start_date: p.startDate, end_mode: p.endDate ? 'date' : 'none', end_date: p.endDate, length_days: null,
          goal: p.goal, goal_target: p.goalTarget, slot_min: p.slotMin, cadence: p.cadence, track_time: true, timezone: p.timezone,
          place_wording: jsonb({}), description: text.description ? jsonb(text.description) : null,
          landing: jsonb(text.landing), email_text: jsonb(text.emailText), branding: jsonb(p.branding),
          cta: jsonb({}), share: jsonb({}), published_at: p.publishedAt, ended_at: p.endedAt, created_at: p.publishedAt, updated_at: now
        }).returningAll().executeTakeFirstOrThrow()
        campaigns.set(p.wpId, { ...row, start_date: p.startDate, end_date: p.endDate })
      }

      for (const row of siteText?.siteStrings ?? []) {
        await tx.insertInto('pt_site_string').values({ key: row.key, language: row.language, value: row.value, updated_at: now }).execute()
      }

      const signup = await importSignupFields(wp, b.blog_id, tx, { defaultLanguage, languages })
      out.signupFields = signup.fields.length
      if (signup.skipped.length) out.warnings.push(`signup fields not imported: ${signup.skipped.join(', ')}`)
      const res = await importSubscribers(wp, b.blog_id, tx, { orgId: org.id, sendConfirmations: !!args['send-confirmations'], fields: signup.fields, campaigns, languages, defaultLanguage, now })
      news.push(...res.news)
      out.subscribers = res.counts
      out.warnings.push(...res.warnings)
      if (!args['no-content']) out.content = await importContent(wp, b.blog_id, tx, { campaigns, images, unknown: unknownKinds })
      for (const p of out.content?.pastEnd ?? []) {
        const days = p.days.length > 3 ? `days ${p.days[0]}–${p.days[p.days.length - 1]}` : `day${p.days.length > 1 ? 's' : ''} ${p.days.join(', ')}`
        out.warnings.push(`${p.campaign}: ${p.days.length} prayer content ${p.days.length > 1 ? 'days' : 'day'} past the campaign's end (${days}), imported but not shown`)
      }
      const msgs = await importMessages(wp, b.blog_id, tx, { campaigns, names: res.names, emails: res.emails, defaultLanguage, timezone: latest?.timezone ?? 'UTC' })
      out.messages = msgs.counts
      if (msgs.unparsed.length) out.warnings.push(`${msgs.unparsed.length} story or contact comments not in a known format: ${msgs.unparsed.slice(0, 5).join(', ')}`)
      out.stats = await importStats(wp, b.blog_id, tx, { campaigns, hosts: [b.domain.toLowerCase(), ...(CUSTOM_DOMAINS[b.blog_id] ?? []), ...(PRAYING_HOSTS[b.blog_id] ?? [])], praying, timezone: latest?.timezone ?? 'UTC' })
      // The directory shows a site's own picture, not the plugin's stencil.
      heroUrl = latest && !isStencil(latest.branding.image_url) ? (campaigns.get(latest.wpId)?.branding as CampaignBranding | undefined)?.image_url ?? null : null
      out.status = archived ? 'archived' : 'published'
      out.campaigns = plans.length
      out.sideCampaigns = plans.filter(p => p.kind).length
      out.team = team.size
    })

    // Every site asks to be in the directory unless it opted out in WordPress.
    if (listed) {
      const description = siteText?.description
      await db.insertInto('pt_directory_entry').values({
        org_id: org.id, slug, name: decode(opts.get('blogname') || slug).slice(0, 200),
        description: description ? (description.values[description.source] ?? '').slice(0, 500) || null : null,
        languages: pgArray(languages),
        image_url: heroUrl,
        status: 'requested', requested_at: now, updated_at: now
      }).execute()
    }
    out.directory = listed
    out.peopleGroups = !!peopleGroups
  } catch (err) {
    await db.deleteFrom('orgs').where('id', '=', org.id).execute()
    throw err
  }

  const [wpSubs] = await wp.unsafe(`SELECT count(*) n FROM ${table(b.blog_id, 'posts')} WHERE post_type = 'subscriptions' AND post_status NOT IN ('trash', 'auto-draft')`) as { n: number }[]
  const [wpTimes] = await tableExists(wp, table(b.blog_id, 'dt_reports'))
    ? await wp.unsafe(`SELECT sum(type = 'recurring_signup') rules, sum(type IN ('campaign_app', 'pending_signup') AND subtype = 'recurring_signup') rule_times, sum(type IN ('campaign_app', 'pending_signup') AND subtype = 'selected_time') picked FROM ${table(b.blog_id, 'dt_reports')} WHERE post_type = 'subscriptions'`) as { rules: number | null, rule_times: number | null, picked: number | null }[]
    : [{ rules: 0, rule_times: 0, picked: 0 }]
  out.wp = { subscriptions: Number(wpSubs?.n ?? 0), recurringRules: Number(wpTimes?.rules ?? 0), ruleTimes: Number(wpTimes?.rule_times ?? 0), pickedTimes: Number(wpTimes?.picked ?? 0) }
  return out
}

const started = Date.now()
for (const b of blogs) {
  if (onlyBlogs && !onlyBlogs.has(b.blog_id)) continue
  try {
    const r = await importBlog(b)
    report.push(r)
    const s = r.subscribers
    console.log(`${String(b.blog_id).padStart(4)} ${r.slug.padEnd(32)} ${r.result}${s ? `  ${r.campaigns} campaigns, ${s.subscriptions} subscribers, ${s.recurring + s.recurringFromPicked + s.dates} prayer times` : ''}${r.warnings.length ? `  (${r.warnings.length} warnings)` : ''}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    report.push({ blogId: b.blog_id, domain: b.domain, slug: slugs.get(b.blog_id)!, result: 'skipped', warnings: [`failed: ${message}`] })
    console.error(`${String(b.blog_id).padStart(4)} ${slugs.get(b.blog_id)} FAILED: ${message}`)
    if (process.env.WP_IMPORT_DEBUG) console.error(err)
  }
}

// "News from Prayer.Tools" lives on the staff org's contacts.
await db.insertInto('orgs').values({ slug: 'staff', name: 'Prayer.Tools', created_at: now, updated_at: now }).onConflict(oc => oc.column('slug').doNothing()).execute()
const staff = await db.selectFrom('orgs').select('id').where('slug', '=', 'staff').executeTakeFirstOrThrow()
const unique = [...new Map(news.map(n => [n.email, n])).values()]
const granted = await withOrg(app, staff.id, tx => grantNews(tx, unique))

// ── Report ─────────────────────────────────────────────────────────────────

const imported = report.filter(r => r.result === 'imported')
const sum = (f: (r: SiteReport) => number) => imported.reduce((n, r) => n + f(r), 0)
const totals = {
  sites: imported.length,
  archivedSites: imported.filter(r => r.status === 'archived').length,
  existing: report.filter(r => r.result === 'exists').length,
  skipped: report.filter(r => r.result === 'skipped').length,
  campaigns: sum(r => r.campaigns ?? 0),
  sideCampaigns: sum(r => r.sideCampaigns ?? 0),
  teamMembers: sum(r => r.team ?? 0),
  operators: [...users.values()].filter(u => siteAdmins.has(u.user_login)).length,
  wpSubscriptions: sum(r => r.wp?.subscriptions ?? 0),
  subscriptions: sum(r => r.subscribers?.subscriptions ?? 0),
  mergedDuplicates: sum(r => r.subscribers?.merged ?? 0),
  noEmail: sum(r => r.subscribers?.noEmail ?? 0),
  invalidEmail: sum(r => r.subscribers?.invalidEmail ?? 0),
  unverified: sum(r => r.subscribers?.unverified ?? 0),
  unsubscribed: sum(r => r.subscribers?.unsubscribed ?? 0),
  remindersOff: sum(r => r.subscribers?.remindersOff ?? 0),
  wpRecurringRules: sum(r => r.wp?.recurringRules ?? 0),
  wpRuleTimes: sum(r => r.wp?.ruleTimes ?? 0),
  rulesDeletedInWp: sum(r => r.subscribers?.deletedRules ?? 0),
  rulesWithoutTimes: sum(r => r.subscribers?.rulesWithoutTimes ?? 0),
  recurringFromRules: sum(r => r.subscribers?.recurring ?? 0),
  wpPickedTimes: sum(r => r.wp?.pickedTimes ?? 0),
  pickedDuplicatesDropped: sum(r => r.subscribers?.pickedDuplicates ?? 0),
  pickedTimesAsRules: sum(r => r.subscribers?.pickedAsRules ?? 0),
  recurringFromPicked: sum(r => r.subscribers?.recurringFromPicked ?? 0),
  dateCommitments: sum(r => r.subscribers?.dates ?? 0),
  pickedTimesSkipped: sum(r => r.subscribers?.datesSkipped ?? 0),
  legacyKeys: sum(r => r.subscribers?.legacyKeys ?? 0),
  platformNews: granted,
  pendingSkipped: sum(r => r.subscribers?.pendingSkipped ?? 0),
  prayerTimesMadeMonthly: sum(r => r.subscribers?.madeMonthly ?? 0),
  pendingImported: sum(r => r.subscribers?.pendingImported ?? 0),
  confirmationsQueued: sum(r => r.subscribers?.confirmationsQueued ?? 0),
  stories: sum(r => r.messages?.stories ?? 0),
  contactMessages: sum(r => r.messages?.contacts ?? 0),
  messagesUnparsed: sum(r => r.messages?.unparsed ?? 0),
  statPrayers: sum(r => r.stats?.prayers ?? 0),
  statGroupPrayers: sum(r => r.stats?.groupPrayers ?? 0),
  statSignups: sum(r => r.stats?.signups ?? 0),
  directoryRequested: imported.filter(r => r.directory).length,
  signupFields: sum(r => r.signupFields ?? 0),
  sitesWithPeopleGroups: imported.filter(r => r.peopleGroups).length,
  aliases: imported.filter(r => r.alias).length,
  fuelPosts: sum(r => r.content?.posts ?? 0),
  contentEntries: sum(r => r.content?.entries ?? 0),
  fuelDrafts: sum(r => r.content?.drafts ?? 0),
  fuelNoCampaignOrDay: sum(r => r.content?.noCampaignOrDay ?? 0),
  fuelCampaignDeleted: sum(r => r.content?.campaignDeleted ?? 0),
  fuelPostsCombined: sum(r => r.content?.combinedPosts ?? 0),
  fuelIdenticalDropped: sum(r => r.content?.identicalDropped ?? 0),
  fuelDaysPastCampaignEnd: sum(r => (r.content?.pastEnd ?? []).reduce((n, p) => n + p.days.length, 0)),
  campaignsWithDaysPastEnd: sum(r => r.content?.pastEnd.length ?? 0),
  imagesCopied: images.report.copied,
  imagesSubstituted: images.report.substituted.length,
  imagesMissing: images.report.missing.length,
  imagesNotCopyable: images.report.notUploads.length,
  imagesExternal: images.report.external,
  warnings: report.reduce((n, r) => n + r.warnings.length, 0),
  seconds: Math.round((Date.now() - started) / 1000)
}
const dir = join(import.meta.dir, '..', '..', '.data')
await mkdir(dir, { recursive: true })
await writeFile(join(dir, args.blogs ? 'wp-import-report-partial.json' : 'wp-import-report.json'), JSON.stringify({
  at: now.toISOString(), totals, unknownContent: Object.fromEntries([...unknownKinds].sort((a, b) => b[1] - a[1])), images: images.report, sites: report
}, null, 2))
console.log('\n', totals)
console.log(`Report: ${join(dir, args.blogs ? 'wp-import-report-partial.json' : 'wp-import-report.json')}`)
await wp.close()
await db.destroy()
await app.destroy()
