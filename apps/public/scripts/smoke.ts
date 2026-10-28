// End-to-end smoke test against the running public dev server, Mailpit (8025)
// and the seeded dev database. Creates its own test people
// (smoke+<run>@example.com) and removes them at the end.
// Usage (from apps/public): bun run scripts/smoke.ts
// Env: PT_SECRET and APP_DATABASE_URL (read from .env), ADMIN_DATABASE_URL (the
//      same database on the admin role), PUBLIC_URL (the running public server).
import { sql } from 'kysely'
import { createDb } from '@prayertools/shared/db/connect'
import { withOrg } from '@prayertools/shared/db/scope'
import { hashToken, randomToken } from '@prayertools/shared/tokens'
import { manageToken, unsubscribeToken } from '@prayertools/shared/links'

if (!process.env.PUBLIC_URL || !process.env.ADMIN_DATABASE_URL) {
  console.error('Set PUBLIC_URL (the running public server) and ADMIN_DATABASE_URL (its database, admin role).')
  process.exit(1)
}
const BASE = process.env.PUBLIC_URL
const PORT = new URL(BASE).port || '80'
const admin = createDb(process.env.ADMIN_DATABASE_URL)
const app = createDb(process.env.APP_DATABASE_URL!)
const run = Date.now().toString(36)
const emails: string[] = []
const accounts: string[] = []
let failures = 0

function email(tag: string): string {
  const e = `smoke+${run}-${tag}@example.com`
  emails.push(e)
  return e
}

function check(name: string, ok: unknown, detail?: unknown): void {
  if (ok) console.log(`  ✓ ${name}`)
  else {
    failures++
    console.log(`  ✗ ${name}`, detail ?? '')
  }
}

interface Res { status: number, headers: Headers, text: string, json: () => any, cookies: string[] }

async function req(host: string, path: string, init: { method?: string, body?: unknown, raw?: string, headers?: Record<string, string>, cookie?: string } = {}): Promise<Res> {
  const headers: Record<string, string> = { host: `${host}:${PORT}`, ...(init.headers ?? {}) }
  if (init.cookie) headers.cookie = init.cookie
  let body: string | undefined
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(init.body)
  } else if (init.raw !== undefined) {
    headers['content-type'] = 'application/x-www-form-urlencoded'
    body = init.raw
  }
  const r = await fetch(`${BASE}${path}`, { method: init.method ?? (body ? 'POST' : 'GET'), headers, body, redirect: 'manual' })
  const text = await r.text()
  return { status: r.status, headers: r.headers, text, json: () => JSON.parse(text), cookies: r.headers.getSetCookie() }
}

function cookieOf(res: Res, name: string): string {
  const c = res.cookies.find(c => c.startsWith(`${name}=`))
  return c ? c.split(';')[0]! : ''
}

async function mailTo(address: string, pattern: RegExp, tries = 20): Promise<{ subject: string, match: string } | null> {
  for (let i = 0; i < tries; i++) {
    const list = await (await fetch(`http://localhost:8025/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`)).json() as { messages: { ID: string, Subject: string }[] }
    for (const m of list.messages ?? []) {
      const msg = await (await fetch(`http://localhost:8025/api/v1/message/${m.ID}`)).json() as { Text: string }
      const found = msg.Text.match(pattern)
      if (found) return { subject: m.Subject, match: found[0] }
    }
    await Bun.sleep(250)
  }
  return null
}

async function orgId(slug: string): Promise<string> {
  return (await admin.selectFrom('orgs').select('id').where('slug', '=', slug).executeTakeFirstOrThrow()).id
}

const SITE = 'ramadan-demo.localhost'
const COVERAGE = 'demo-247.localhost'

console.log('Hosts')
check('unknown host → 404', (await req('nope-nope.localhost', '/')).status === 404)
check('custom domain not in pt_site_domain → 404', (await req('example.org', '/')).status === 404)
check('draft site without preview → 404', (await req('draft-site.localhost', '/')).status === 404)
const plat = await req('localhost', '/')
check('platform / → landing page or marketing redirect', plat.status === 200 || (plat.status === 302 && /prayer\.tools/.test(plat.headers.get('location') ?? '')))
check('api host root → 404', (await req('api.localhost', '/')).status === 404)
check('api host serves no site pages', (await req('api.localhost', '/pray')).status === 404)
const go = await req('go.localhost', '/ramadan-demo?utm_source=qr')
check('go host → site redirect keeps query', go.status === 302 && go.headers.get('location') === `http://ramadan-demo.localhost:${PORT}?utm_source=qr`, go.headers.get('location'))
check('go host draft → 404', (await req('go.localhost', '/draft-site')).status === 404)
check('site host has no /my', (await req(SITE, '/my')).status === 404)
check('site host has no /v1', (await req(SITE, '/v1/directory')).status === 404)

console.log('Landing, languages, caching')
for (const [path, lang, dir] of [['/', 'en', 'ltr'], ['/fr', 'fr', 'ltr'], ['/ar', 'ar', 'rtl']] as const) {
  const r = await req(SITE, path)
  check(`${path} renders lang=${lang} dir=${dir}`, r.status === 200 && r.text.includes(`lang="${lang}"`) && r.text.includes(`dir="${dir}"`))
  check(`${path} shared cache`, r.headers.get('cache-control') === 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400', r.headers.get('cache-control'))
  check(`${path} not framable`, r.headers.get('x-frame-options') === 'SAMEORIGIN')
}
check('Arabic UI strings', (await req(SITE, '/ar')).text.includes('صلاتي'))
const pray6 = await req(SITE, '/pray/6')
check('/pray/6 content with placeholders filled', pray6.status === 200 && pray6.text.includes('Day 6: pray for Damascus') && !pray6.text.includes('{place}'))
check('/fr/pray/6 French content', (await req(SITE, '/fr/pray/6')).text.includes('Jour 6'))
check('/2026/pray/6 (campaign segment) works', (await req(SITE, '/2026/pray/6')).status === 200)
const p404 = await req(SITE, '/pray/999')
check('/pray/999 → 404 with short cache', p404.status === 404 && p404.headers.get('cache-control') === 'public, max-age=0, s-maxage=60')
check('/stats renders', (await req(SITE, '/stats')).text.includes('Prayer so far'))
check('/manage is private', (await req(SITE, '/manage')).headers.get('cache-control') === 'private, no-store')
const embed = await req(SITE, '/embed')
check('/embed is framable', embed.status === 200 && !embed.headers.get('x-frame-options'))
check('/embed.js served', (await req(SITE, '/embed.js')).text.includes('pt-embed-height'))
check('coverage page on 24/7 site', (await req(COVERAGE, '/coverage')).status === 200)
const cov = await req(COVERAGE, '/api/coverage.json')
check('coverage.json has 7 days and brief cache', cov.status === 200 && cov.json().days.length === 7 && /s-maxage=60/.test(cov.headers.get('cache-control') ?? ''))
check('legacy fuel URL → prayer content', (await req(SITE, '/prayer/fuel/6')).headers.get('location') === '/pray/6')

console.log('Web signup → verify → manage')
const e1 = email('web')
const signup = await req(SITE, '/api/signup', { body: {
  email: e1, name: 'Smoke', language: 'fr', timezone: 'Europe/Paris',
  commitments: [{ kind: 'recurring', frequency: 'weekly', days_of_week: [1, 3], time: '21:00' }],
  consents: { site_updates: true, platform_news: true, custom: [] }, answers: {}
} })
if (signup.status === 429) {
  console.log('  Rate limited (signups are limited per IP per minute): wait a minute and run again.')
  process.exit(2)
}
check('signup accepted, needs verification', signup.status === 200 && signup.json().verify === true, signup.text)
const ramadan = await orgId('ramadan-demo')
const sub1 = await withOrg(admin, ramadan, tx => tx.selectFrom('pt_subscription as s')
  .innerJoin('crm_contact_channels as cc', 'cc.record_id', 's.contact_id')
  .innerJoin('crm_channels as ch', 'ch.id', 'cc.channel_id')
  .select(['s.id', 's.verified_at', 's.language', 's.timezone'])
  .where('ch.normalized_value', '=', e1).executeTakeFirst())
check('subscription row created (fr, Europe/Paris, unverified)', sub1 && !sub1.verified_at && sub1.language === 'fr' && sub1.timezone === 'Europe/Paris', sub1)
const cm1 = await admin.selectFrom('pt_commitment').selectAll().where('subscription_id', '=', sub1!.id).execute()
check('commitment stored without reminder until verified', cm1.length === 1 && cm1[0]!.next_reminder_utc === null)
const staffNews = await sql<{ n: number }>`select count(*)::int n from crm_channel_consents c join orgs o on o.id = c.org_id join crm_channels ch on ch.id = c.channel_id where o.slug = 'staff' and c.purpose = 'platform_news' and ch.normalized_value = ${e1}`.execute(admin)
check('platform news consent in staff org', staffNews.rows[0]!.n === 1)
const verifyMail = await mailTo(e1, /\/verify\/[A-Za-z0-9_-]+/)
check('verification email arrives in French', !!verifyMail && /Confirmez/.test(verifyMail.subject), verifyMail)
const verify = await req(SITE, verifyMail!.match)
const manageCookie = cookieOf(verify, 'pt_m')
check('verify → today\'s prayer content with confirmed note + manage cookie', verify.status === 302 && verify.headers.get('location') === '/fr/pray?confirmed=1' && !!manageCookie, verify.headers.get('location'))
const cm1b = await admin.selectFrom('pt_commitment').select('next_reminder_utc').where('subscription_id', '=', sub1!.id).executeTakeFirstOrThrow()
check('reminder scheduled after verification', cm1b.next_reminder_utc !== null)
check('verify link is single-use', (await req(SITE, verifyMail!.match)).status === 200)
const again = await req(SITE, '/api/signup', { body: { email: e1, language: 'en', timezone: 'UTC', commitments: [{ frequency: 'daily', time: '05:00' }], consents: {} } })
check('re-signup of a verified address adds nothing (manage link sent instead)', again.json().verify === true && (await admin.selectFrom('pt_commitment').select('id').where('subscription_id', '=', sub1!.id).execute()).length === 1)

const manage = (await req(SITE, '/api/view?path=/manage', { cookie: manageCookie })).json()
check('manage view shows the subscription', manage.page.manage?.email === e1)
check('add prayer time', (await req(SITE, '/api/manage/commitments', { cookie: manageCookie, body: { frequency: 'daily', time: '06:15' } })).status === 200)
check('change profile + timezone', (await req(SITE, '/api/manage/profile', { cookie: manageCookie, body: { name: 'Marie', timezone: 'America/Chicago' } })).status === 200)
const cms = await admin.selectFrom('pt_commitment').selectAll().where('subscription_id', '=', sub1!.id).execute()
check('timezone change moves commitments', cms.length === 2 && cms.every(c => c.timezone === 'America/Chicago'))
check('pause a prayer time', (await req(SITE, `/api/manage/commitments/${cms[0]!.id}`, { method: 'PATCH', cookie: manageCookie, body: { paused: true } })).status === 200)
check('consent toggle', (await req(SITE, '/api/manage/consent', { cookie: manageCookie, body: { purpose: 'site_updates', grant: false } })).status === 200)
const exp = await req(SITE, '/api/manage/export', { cookie: manageCookie })
check('download my data', exp.status === 200 && JSON.parse(exp.text).profile.email === e1)
const oneIcs = await req(SITE, `/api/manage/commitments/${cms[1]!.id}.ics`, { cookie: manageCookie })
check('one-off .ics', oneIcs.status === 200 && oneIcs.text.includes('BEGIN:VEVENT'))
const icsUrl = new URL(manage.page.manage.icsUrl.replace(/^webcal:/, 'http:'))
const feed = await req(SITE, icsUrl.pathname)
check('webcal feed lists occurrences in UTC', feed.status === 200 && /DTSTART:\d{8}T\d{6}Z/.test(feed.text))
check('manage without cookie is refused', (await req(SITE, '/api/manage/profile', { body: { name: 'x' } })).status === 401)
const me = (await req(SITE, '/api/me', { cookie: manageCookie })).json()
check('/api/me gives referral code for sharing', typeof me.referral_code === 'string')

const stale = manageToken(ramadan, sub1!.id, 999)
const stalePage = await req(SITE, `/m/${stale}`)
check('outdated manage link shows the fresh-link page', stalePage.status === 200 && stalePage.text.includes('This link has expired'))
check('fresh link request answers the same way', (await req(SITE, '/api/manage/fresh-link', { body: { token: stale } })).json().ok === true)
const fresh = await mailTo(e1, /\/m\/[A-Za-z0-9_.-]+/)
const freshRes = fresh ? await req(SITE, new URL(fresh.match, 'http://x').pathname.replace(/^.*\/m\//, '/m/')) : null
check('fresh manage link → cookie + clean /manage', freshRes?.status === 302 && freshRes.headers.get('location') === '/manage' && !!cookieOf(freshRes, 'pt_m'))

console.log('Referral signup + isolation')
const e2 = email('ref')
await req(SITE, '/api/signup', { body: { email: e2, language: 'en', timezone: 'UTC', referral: me.referral_code, commitments: [{ frequency: 'daily', time: '08:00' }], consents: {} } })
const refSub = await withOrg(admin, ramadan, tx => tx.selectFrom('pt_subscription').select('referred_by').where('referred_by', '=', me.referral_code).executeTakeFirst())
check('signup through ?r= recorded as share signup', !!refSub)
const beirut = await orgId('demo-247')
const seenFromB = await withOrg(app, beirut, tx => tx.selectFrom('pt_subscription').select('id').where('id', '=', sub1!.id).executeTakeFirst())
const seenFromA = await withOrg(app, ramadan, tx => tx.selectFrom('pt_subscription').select('id').where('id', '=', sub1!.id).executeTakeFirst())
const noScope = await app.selectFrom('pt_subscription').select('id').execute()
check('app role: site A signup visible in A, invisible from site B scope and without scope', !!seenFromA && !seenFromB && noScope.length === 0)

console.log('Prayer sessions')
const view = (await req(SITE, '/api/view?path=/pray')).json()
const campaignId = view.site.campaign.id
const pTok = manage.page.manage.prayUrl.split('#p=')[1]
const sid = crypto.randomUUID()
const ping1 = await req(SITE, '/api/pray/ping', { body: { id: sid, campaign: campaignId, day: 6, language: 'fr', source: 'manage', p: pTok } })
check('first ping', ping1.status === 200 && ping1.json().praying_now >= 1)
await Bun.sleep(1100)
await req(SITE, '/api/pray/ping', { body: { id: sid, campaign: campaignId, day: 6, language: 'fr', source: 'manage', p: pTok } })
await req(SITE, '/api/pray/amen', { body: { id: sid } })
await req(SITE, '/api/pray/amen', { body: { id: sid } })
const session = await sql<{ seconds: number, completed: boolean, subscription_id: string }>`select seconds, completed, subscription_id from pt_prayer_session where id = ${sid}`.execute(admin)
check('session upserted, identified by the personal token, amen completes it', session.rows.length === 1 && session.rows[0]!.completed && session.rows[0]!.subscription_id === sub1!.id && session.rows[0]!.seconds >= 1)
const total = await admin.selectFrom('pt_person_total').selectAll().where('subscription_id', '=', sub1!.id).executeTakeFirst()
check('person totals updated', total?.prayers === 1 && Number(total.seconds) >= 1)
check('group prayer count', (await req(SITE, '/api/pray/group', { body: { id: sid, campaign: campaignId, day: 6, count: 4 } })).status === 200)

console.log('Analytics relay')
const origin = `http://${SITE}:${PORT}`
check('collect rejects cross-origin', (await req(SITE, '/api/collect', { body: { event_type: 'pageview' }, headers: { origin: 'https://evil.test' } })).status === 403)
check('collect rejects unknown event types', (await req(SITE, '/api/collect', { body: { event_type: 'purchase' }, headers: { origin } })).status === 400)
const pv = await req(SITE, '/api/collect', { body: { event_type: 'pageview', url: `${origin}/pray/6`, anonymous_hash: `v-${run}`, metadata: { utm_source: 'smoke' } }, headers: { origin, 'cf-ipcountry': 'FR' } })
check('pageview returns an id field', pv.status === 200 && 'id' in pv.json())
check('shares are relayed with 202', (await req(SITE, '/api/collect', { body: { event_type: 'campaign_shared', metadata: { channel: 'copy' } }, headers: { origin } })).status === 202)
check('heartbeat 202', (await req(SITE, '/api/collect/heartbeat', { body: { event_id: 'x', value: 30 }, headers: { origin } })).status === 202)

console.log('Contact and stories')
check('contact form', (await req(SITE, '/api/contact', { body: { email: email('contact'), name: 'Ann', message: 'Hello team\nTypo on day 3' } })).status === 200)
const storyEmail = email('story')
check('story form', (await req(SITE, '/api/story', { body: { email: storyEmail, name: 'Ann', story: 'God answered.', may_publish: true, use_name: true } })).status === 200)
const threads = await withOrg(admin, ramadan, tx => tx.selectFrom('inbox_conversations').select('source').where('counterparty_name', '=', 'Ann').execute())
check('inbox threads opened (contact_form + story)', threads.some(t => t.source === 'contact_form') && threads.some(t => t.source === 'story'))
check('story acknowledgement email', !!(await mailTo(storyEmail, /story|God/i)))

console.log('Unsubscribe and check-ins')
const uTok = unsubscribeToken(ramadan, sub1!.id)
check('/u page asks for confirmation', (await req(SITE, `/u/${uTok}`)).text.includes('Unsubscribe'))
const oneClick = await req(SITE, `/u/${uTok}`, { method: 'POST', raw: 'List-Unsubscribe=One-Click' })
const status1 = await admin.selectFrom('pt_subscription').select('status').where('id', '=', sub1!.id).executeTakeFirstOrThrow()
check('one-click unsubscribe', oneClick.status === 200 && status1.status === 'unsubscribed')
const ckToken = randomToken(24)
await withOrg(admin, ramadan, tx => tx.insertInto('pt_checkin').values({ subscription_id: sub1!.id, kind: 'checkin', token_hash: hashToken(ckToken) }).execute())
await admin.updateTable('pt_subscription').set({ status: 'inactive' }).where('id', '=', sub1!.id).execute()
const ck = await req(SITE, `/checkin/${ckToken}/yes`)
const afterCk = await admin.selectFrom('pt_subscription').select(['status', 'checkin_cycle_started_at']).where('id', '=', sub1!.id).executeTakeFirstOrThrow()
check('check-in "yes" reactivates and completes the cycle', ck.headers.get('location') === '/notice/checkin_yes' && afterCk.status === 'active')

console.log('Draft preview and legacy links')
const draft = await orgId('draft-site')
const prev = await withOrg(admin, draft, tx => tx.selectFrom('pt_site').select('preview_token_hash').executeTakeFirstOrThrow())
const pvToken = randomToken(24)
await withOrg(admin, draft, tx => tx.updateTable('pt_site').set({ preview_token_hash: hashToken(pvToken) }).execute())
try {
  const enter = await req('draft-site.localhost', `/preview/${pvToken}`)
  const pc = cookieOf(enter, 'pt_preview')
  const page = await req('draft-site.localhost', '/', { cookie: pc })
  check('preview link opens the draft, never cached', enter.status === 302 && page.status === 200 && page.headers.get('cache-control') === 'private, no-store')
  check('wrong preview token → 404', (await req('draft-site.localhost', '/preview/nope')).status === 404)
} finally {
  await withOrg(admin, draft, tx => tx.updateTable('pt_site').set({ preview_token_hash: prev.preview_token_hash }).execute())
}
const legacyKey = randomToken(12)
await admin.insertInto('pt_legacy_key').values({ org_id: ramadan, kind: 'manage', key_hash: hashToken(legacyKey), subscription_id: sub1!.id }).execute()
const legacy = await req(SITE, `/subscriptions_app/manage/${legacyKey}`)
check('legacy manage link → cookie + /manage', legacy.status === 302 && legacy.headers.get('location') === '/manage' && !!cookieOf(legacy, 'pt_m'))
check('unknown legacy key → polite 404', (await req(SITE, '/subscriptions_app/manage/unknown')).status === 404)
await admin.deleteFrom('pt_legacy_key').where('key_hash', '=', hashToken(legacyKey)).execute()

console.log('My prayer')
check('link request always answers the same', (await req('localhost', '/api/my/link', { body: { email: 'nobody@example.com' } })).json().ok === true)
await req('localhost', '/api/my/link', { body: { email: e1.toUpperCase(), language: 'en' } })
const myMail = await mailTo(e1, /\/my\/login\/[A-Za-z0-9_-]+/)
check('My prayer link emailed', !!myMail)
const login = await req('localhost', new URL(myMail!.match, 'http://x').pathname.replace(/^.*\/my\//, '/my/'))
const myCookie = cookieOf(login, 'pt_session')
check('login exchanges the token for a session cookie', login.status === 302 && login.headers.get('location') === '/my' && !!myCookie)
check('login token is single-use', (await req('localhost', new URL(myMail!.match, 'http://x').pathname.replace(/^.*\/my\//, '/my/'))).headers.get('location') === '/my?notice=link_invalid')
const my = (await req('localhost', '/api/view?path=/my', { cookie: myCookie })).json()
const mySite = my.page.my.sites.find((s: { orgId: string }) => s.orgId === ramadan)
check('My prayer lists the verified site', my.page.my.signedIn && !!mySite)
check('My prayer change applied in the site org', (await req('localhost', `/api/my/${ramadan}/${mySite.subscriptionId}/profile`, { cookie: myCookie, body: { language: 'ar' } })).status === 200
  && (await admin.selectFrom('pt_subscription').select('language').where('id', '=', sub1!.id).executeTakeFirstOrThrow()).language === 'ar')
check('My prayer export', (await req('localhost', '/api/my/export', { cookie: myCookie })).status === 200)
await req('localhost', '/api/my/logout', { method: 'POST', cookie: myCookie })
check('sign out revokes the session', (await req('localhost', '/api/my/export', { cookie: myCookie })).status === 401)

console.log('App API')
const reg = await req('api.localhost', '/v1/devices', { body: { platform: 'ios', app_version: '1.0.0', timezone: 'Asia/Beirut', language: 'en' } })
const device = reg.json()
accounts.push(device.intercessor_id)
const auth = { authorization: `Bearer ${device.credential}` }
check('device registration', reg.status === 201 && !!device.credential)
check('site info', (await req('api.localhost', '/v1/sites/demo-247')).json().current_campaign?.goal === 'coverage')
check('content JSON', (await req('api.localhost', '/v1/sites/ramadan-demo/content/6?language=fr')).json().blocks.length > 0)
check('subscribe', (await req('api.localhost', '/v1/sites/demo-247/subscription', { method: 'PUT', headers: auth, body: { language: 'en', timezone: 'Asia/Beirut' } })).status === 200)
const appCm = await req('api.localhost', '/v1/sites/demo-247/commitments', { headers: auth, body: { kind: 'recurring', frequency: 'daily', time: '03:00', timezone: 'Asia/Beirut', duration_min: 30 } })
check('commitment created without email reminder', appCm.status === 201 && (await admin.selectFrom('pt_commitment').select('next_reminder_utc').where('id', '=', appCm.json().id).executeTakeFirstOrThrow()).next_reminder_utc === null)
const appCampaign = appCm.json().campaign_id
check('ping', (await req('api.localhost', '/v1/sites/demo-247/pings', { headers: auth, body: { id: crypto.randomUUID(), campaign: appCampaign, day: 1 } })).status === 200)
const amenId = crypto.randomUUID()
const a1 = await req('api.localhost', '/v1/sites/demo-247/amen', { headers: auth, body: { id: amenId, campaign: appCampaign, day: 1, seconds: 300 } })
const a2 = await req('api.localhost', '/v1/sites/demo-247/amen', { headers: auth, body: { id: amenId, campaign: appCampaign, day: 1, seconds: 300 } })
check('amen recorded once, repeat ignored', a1.json().recorded === true && a2.json().recorded === false)
const subs = (await req('api.localhost', '/v1/me/subscriptions', { headers: auth })).json()
check('subscription status list', subs.subscriptions.length === 1 && subs.subscriptions[0].campaigns[0].commitments.length === 1)
check('directory', (await req('api.localhost', '/v1/directory')).status === 200)
check('collect app_open', (await req('api.localhost', '/v1/collect', { headers: auth, body: { event_type: 'app_open' } })).status === 202)
check('unsubscribe', (await req('api.localhost', '/v1/sites/demo-247/subscription', { method: 'DELETE', headers: auth })).json().status === 'unsubscribed')
check('unauthenticated calls refused', (await req('api.localhost', '/v1/me/subscriptions')).status === 401)
check('OpenAPI served', (await req('api.localhost', '/v1/openapi.json')).json().openapi?.startsWith('3.'))

console.log('Clean-up')
for (const org of [ramadan, beirut, await orgId('staff')]) {
  await withOrg(admin, org, async (tx) => {
    const channels = await tx.selectFrom('crm_channels').select('id').where('normalized_value', 'in', emails).execute()
    const ids = channels.map(c => c.id)
    if (!ids.length) return
    const contacts = await tx.selectFrom('crm_contact_channels').select('record_id').where('channel_id', 'in', ids).execute()
    const conv = await tx.selectFrom('inbox_conversations').select('id').where('channel_id', 'in', ids).execute()
    if (conv.length) await tx.deleteFrom('pt_story').where('conversation_id', 'in', conv.map(c => c.id)).execute()
    await tx.deleteFrom('inbox_conversations').where('channel_id', 'in', ids).execute()
    if (contacts.length) {
      await tx.deleteFrom('pt_subscription').where('contact_id', 'in', contacts.map(c => c.record_id)).execute()
      await tx.deleteFrom('crm_records').where('id', 'in', contacts.map(c => c.record_id)).execute()
    }
    await tx.deleteFrom('crm_channels').where('id', 'in', ids).execute()
  })
}
await admin.deleteFrom('pt_subscription').where('user_id', 'in', accounts).execute()
await admin.deleteFrom('users').where(eb => eb.or([eb('email', 'in', emails), eb('id', 'in', accounts)])).execute()
await admin.destroy()
await app.destroy()

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
