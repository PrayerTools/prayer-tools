// Seeds one or more local sites per use case in USE_CASES.md: an ongoing
// country site with side campaigns, a yearly Ramadan site, a crisis response,
// a start-anytime devotional, a school, a church and a mission agency's
// network of sites, each campaign with intercessors. Dates are relative to
// today, so each campaign is in the state its use case describes on the day
// the script runs.
// Idempotent: a site whose address already exists is left as it is, and a
// campaign that already has prayer times gets no more intercessors.
// Usage: DATABASE_URL=… APP_DATABASE_URL=… PT_SITE_BASE_HOST=… bun run scripts/seed-use-cases.ts
import { sql } from 'kysely'
import { createDb } from '@prayertools/shared/db/connect'
import { withOrg, type Tx } from '@prayertools/shared/db/scope'
import type { CampaignCta, CampaignKind, Cadence, EndMode, Goal, StartMode, TiptapDoc, TranslatableText } from '@prayertools/shared/db/schema'
import { CONSENT_WORDING_VERSION, ensureSystemUser, SYSTEM_USER_ID } from '@prayertools/shared/crm'
import { addDays, daysBetween, localTimeOf, todayIn, weekdayOf } from '@prayertools/shared/dates'
import { textDoc } from '@prayertools/shared/tiptap'
import { jsonb, pgArray } from '@prayertools/shared/db/json'
import { enableSiteApps } from '@prayertools/shared/site'
import { campaignStatus, durationOptions, suggestedStartDate } from '@prayertools/shared/setup'
import { loadCampaigns } from '@prayertools/shared/campaigns'
import { campaignEntries } from '@prayertools/shared/content'
import { createWebSignup, insertCommitment, refreshReminders, setSubscriptionStatus, updateCommitment, validateRuleForCampaign, type CampaignRow, type RuleInput, type SubscriptionRow } from '@prayertools/shared/subscriptions'
import { createAnonymousAccount } from '@prayertools/shared/accounts'
import { bumpStat, type Metric } from '@prayertools/shared/stats'
import { shortCode } from '@prayertools/shared/tokens'
import { heroImagesFor } from '@prayertools/shared/hero-images'
import type { SitePlaceWording } from '@prayertools/shared/place'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')
const baseHost = process.env.PT_SITE_BASE_HOST
if (!baseHost) throw new Error('PT_SITE_BASE_HOST is required')
const appUrl = process.env.APP_DATABASE_URL
if (!appUrl) throw new Error('APP_DATABASE_URL is required')
const db = createDb(url)
// Intercessors sign up on the RLS role, as they do on the public site, so
// contacts and subscriptions are looked up inside their own site only.
const app = createDb(appUrl)
await ensureSystemUser(db)

const owner = await db.selectFrom('users').select('id').where('id', '!=', SYSTEM_USER_ID).orderBy('created', 'asc').executeTakeFirst()
if (!owner) console.warn('No user yet: the sites are created without an owner. Sign up in the admin app first to own them.')

const siteAddress = (slug: string) => `${baseHost.startsWith('localhost') ? 'http' : 'https'}://${slug}.${baseHost}`

// ── Content ────────────────────────────────────────────────────────────────

interface Verse { reference: string, translation: string, text: string }
interface Entry { title: string, intro: string, verse: Verse, points: string[] }

const V = {
  church: { reference: 'Matthew 16:18', translation: 'ESV', text: 'And I tell you, you are Peter, and on this rock I will build my church, and the gates of hell shall not prevail against it.' },
  harvest: { reference: 'Matthew 9:37-38', translation: 'ESV', text: 'The harvest is plentiful, but the laborers are few; therefore pray earnestly to the Lord of the harvest to send out laborers into his harvest.' },
  children: { reference: 'Matthew 19:14', translation: 'ESV', text: 'Let the little children come to me and do not hinder them, for to such belongs the kingdom of heaven.' },
  leaders: { reference: '1 Timothy 2:1-2', translation: 'ESV', text: 'First of all, then, I urge that supplications, prayers, intercessions, and thanksgivings be made for all people, for kings and all who are in high positions, that we may lead a peaceful and quiet life, godly and dignified in every way.' },
  heard: { reference: 'Romans 10:14', translation: 'ESV', text: 'How then will they call on him in whom they have not believed? And how are they to believe in him of whom they have never heard? And how are they to hear without someone preaching?' },
  youth: { reference: '1 Timothy 4:12', translation: 'ESV', text: 'Let no one despise you for your youth, but set the believers an example in speech, in conduct, in love, in faith, in purity.' },
  city: { reference: 'Jeremiah 29:7', translation: 'ESV', text: 'But seek the welfare of the city where I have sent you into exile, and pray to the LORD on its behalf, for in its welfare you will find your welfare.' },
  door: { reference: 'Colossians 4:2-3', translation: 'ESV', text: 'Continue steadfastly in prayer, being watchful in it with thanksgiving. At the same time, pray also for us, that God may open to us a door for the word, to declare the mystery of Christ.' },
  speed: { reference: '2 Thessalonians 3:1', translation: 'ESV', text: 'Finally, brothers, pray for us, that the word of the Lord may speed ahead and be honored, as happened among you.' },
  keep: { reference: 'Psalm 121:8', translation: 'ESV', text: 'The LORD will keep your going out and your coming in from this time forth and forevermore.' },
  refuge: { reference: 'Psalm 46:1', translation: 'ESV', text: 'God is our refuge and strength, a very present help in trouble.' },
  near: { reference: 'Psalm 34:18', translation: 'ESV', text: 'The LORD is near to the brokenhearted and saves the crushed in spirit.' },
  heals: { reference: 'Psalm 147:3', translation: 'ESV', text: 'He heals the brokenhearted and binds up their wounds.' },
  fearNot: { reference: 'Isaiah 41:10', translation: 'ESV', text: 'Fear not, for I am with you; be not dismayed, for I am your God; I will strengthen you, I will help you, I will uphold you with my righteous right hand.' },
  wisdom: { reference: 'James 1:5', translation: 'ESV', text: 'If any of you lacks wisdom, let him ask God, who gives generously to all without reproach, and it will be given him.' },
  fear: { reference: 'Proverbs 9:10', translation: 'ESV', text: 'The fear of the LORD is the beginning of wisdom, and the knowledge of the Holy One is insight.' },
  builds: { reference: 'Psalm 127:1', translation: 'ESV', text: 'Unless the LORD builds the house, those who build it labor in vain.' },
  heartily: { reference: 'Colossians 3:23', translation: 'ESV', text: 'Whatever you do, work heartily, as for the Lord and not for men.' },
  glory: { reference: 'Habakkuk 2:14', translation: 'ESV', text: 'For the earth will be filled with the knowledge of the glory of the LORD as the waters cover the sea.' }
} satisfies Record<string, Verse>

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })

function prayerDoc(e: Entry): TiptapDoc {
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: e.title }] },
      p(e.intro),
      { type: 'verse', attrs: { reference: e.verse.reference, translation: e.verse.translation }, content: [p(e.verse.text)] },
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Pray' }] },
      { type: 'bulletList', content: e.points.map(point => ({ type: 'listItem', content: [p(point)] })) }
    ]
  }
}

const FRANCE_REGIONS = [
  'Auvergne-Rhône-Alpes', 'Bourgogne-Franche-Comté', 'Brittany', 'Centre-Val de Loire', 'Corsica', 'Grand Est', 'Hauts-de-France',
  'Île-de-France', 'Normandy', 'Nouvelle-Aquitaine', 'Occitanie', 'Pays de la Loire', 'Provence-Alpes-Côte d\'Azur'
]

const FRANCE_THEMES: { title: string, verse: Verse, points: (region: string) => string[] }[] = [
  { title: 'the church', verse: V.church, points: r => [`Thank God for every church in ${r}, large or small.`, 'Pray for pastors and elders to be encouraged and to stay faithful to Scripture.', 'Pray for unity between churches of different traditions.'] },
  { title: 'workers for the harvest', verse: V.harvest, points: r => [`Ask the Lord of the harvest to send workers to the towns and villages of ${r} that have no church.`, 'Pray for French believers to hear the call and for churches to send them.', 'Pray for those already there to persevere.'] },
  { title: 'families and children', verse: V.children, points: r => [`Pray for children in ${r} to hear about Jesus at home, at school or from a friend.`, 'Pray for parents to follow Christ together.', 'Pray for families under strain to find help and hope.'] },
  { title: 'those who lead', verse: V.leaders, points: r => [`Pray for mayors, councillors and officials in ${r} to serve with integrity.`, 'Pray for freedom to live out and share the faith.', 'Pray for Christians in public life to be salt and light.'] },
  { title: 'those who have never heard', verse: V.heard, points: r => [`Pray for people in ${r} who have never heard the gospel explained.`, 'Pray for neighbours from North Africa, the Middle East and Asia to meet followers of Jesus.', 'Pray for believers to speak with courage and kindness.'] },
  { title: 'students and young people', verse: V.youth, points: r => [`Pray for students in the schools and universities of ${r}.`, 'Pray for student groups to grow and to welcome those who are searching.', 'Pray for young believers to stand firm and set an example.'] },
  { title: 'the good of the city', verse: V.city, points: r => [`Pray for the welfare of the cities and villages of ${r}: work, housing, safety.`, 'Pray for believers to serve the lonely, the poor and the newly arrived.', 'Pray that the church would be known for its love.'] }
]

// One region a week, one theme a day.
const franceEntries: Entry[] = FRANCE_REGIONS.flatMap(region => FRANCE_THEMES.map(theme => ({
  title: `${region}: ${theme.title}`,
  intro: `This week we pray through ${region}. Today we pray for ${theme.title}. Read the verse slowly, then turn it into prayer in your own words before using the points below.`,
  verse: theme.verse,
  points: theme.points(region)
})))

const TEAM_DAYS: [string, string[]][] = [
  ['Travel and arrival', ['Pray for safe travel and for luggage and paperwork to arrive with the team.', 'Pray for rest after the journey.']],
  ['Unity in the team', ['Pray for patience and kindness when the team is tired.', 'Pray that their love for each other would be noticed.']],
  ['The hosts', ['Thank God for the local church receiving the team.', 'Pray that the visit would serve the hosts and not burden them.']],
  ['Listening well', ['Pray for the team to listen before they speak.', 'Pray for good interpreters and clear understanding.']],
  ['Open doors', ['Pray for conversations in cafés, parks and on the street.', 'Pray for people God has already been drawing to himself.']],
  ['Students', ['Pray for the events on campus this week.', 'Pray for students who come back with questions.']],
  ['Health and rest', ['Pray for health, sleep and energy.', 'Pray for a restful day off.']],
  ['Neighbourhood families', ['Pray for the children\'s afternoon and the parents who come.', 'Pray for friendships that last beyond the visit.']],
  ['Boldness', ['Pray for clear and gentle words about Jesus.', 'Pray against fear and discouragement.']],
  ['Scripture', ['Pray for each Bible and Gospel given away to be read.', 'Pray for the Spirit to open hearts through the Word.']],
  ['Seekers', ['Pray for those who asked to meet again.', 'Pray for local believers to walk with them.']],
  ['The local church', ['Pray for the church to be strengthened by the visit.', 'Pray for new people to find a home there.']],
  ['Goodbyes', ['Pray for the last conversations to count.', 'Pray for safe travel home.']],
  ['What comes next', ['Pray for follow-up by the local church.', 'Pray for team members asking whether God is calling them back.']]
]
const teamEntries: Entry[] = TEAM_DAYS.map(([focus, points], i) => ({
  title: `Day ${i + 1}: ${focus}`,
  intro: 'The team is with us for two weeks. Thank you for standing with them in prayer each day.',
  verse: [V.door, V.speed, V.keep][i % 3]!,
  points
}))

const CRISIS_DAYS: [string, string[]][] = [
  ['Those who mourn', ['Pray for families who have lost someone.', 'Pray for comfort that only God can give.']],
  ['Shelter', ['Pray for everyone who has lost a home to find safe shelter.', 'Pray for protection from further storms.']],
  ['Clean water and food', ['Pray for clean water to reach every community.', 'Pray for food supplies and fair distribution.']],
  ['Health', ['Pray for clinics and health workers.', 'Pray against outbreaks of disease.']],
  ['Rescue and relief workers', ['Pray for strength and safety for those bringing help.', 'Pray for roads and bridges to reopen.']],
  ['Children', ['Pray for children who are frightened or separated from family.', 'Pray for schools to reopen.']],
  ['The church', ['Pray for local churches as they serve their neighbours.', 'Pray for pastors who have lost much themselves.']],
  ['Leaders', ['Pray for wisdom for those coordinating the response.', 'Pray for honesty in the use of aid.']],
  ['Livelihoods', ['Pray for farmers and fishers who lost crops, boats and tools.', 'Pray for seed and a good next harvest.']],
  ['Hope', ['Pray for many to find hope in Christ in the middle of loss.', 'Pray for believers to share that hope gently.']],
  ['Rebuilding', ['Pray for homes, schools and clinics to be rebuilt well.', 'Pray for help to keep coming after the news moves on.']],
  ['Staying the course', ['Thank God for what he has done in these days.', 'Ask him how you can keep praying, giving or going.']]
]
const crisisEntries: Entry[] = CRISIS_DAYS.map(([focus, points], i) => ({
  title: `Day ${i + 1}: ${focus}`,
  intro: 'We keep praying for {place} as the response moves from rescue to recovery.',
  verse: [V.refuge, V.near, V.heals, V.fearNot][i % 4]!,
  points
}))

const SCHOOL_FOCUSES: [string, Verse, string[]][] = [
  ['Our students', V.children, ['Pray for each student to know they are loved by God.', 'Pray for those who find school hard this week.']],
  ['Our teachers', V.heartily, ['Pray for energy, patience and joy in the classroom.', 'Pray for teachers to see each child as God does.']],
  ['Our families', V.builds, ['Pray for parents and carers.', 'Pray for homes that are going through a hard time.']],
  ['Learning', V.fear, ['Pray for curiosity and perseverance.', 'Pray for students to grow in wisdom as well as knowledge.']],
  ['Leadership and board', V.wisdom, ['Pray for wisdom in every decision.', 'Pray for the school\'s finances and plans.']],
  ['Friendships', V.youth, ['Pray for kindness in the playground and online.', 'Pray for students who feel left out.']],
  ['Support staff', V.heartily, ['Thank God for office, kitchen, cleaning and maintenance staff.', 'Pray that they would feel valued.']],
  ['Safety and health', V.keep, ['Pray for protection on the roads, on trips and at school.', 'Pray for good health through the term.']],
  ['Our neighbourhood', V.city, ['Pray for the school to be a blessing to the streets around it.', 'Pray for families who are new to the area.']],
  ['Those leaving this year', V.wisdom, ['Pray for students preparing for their next step.', 'Pray that their faith would go with them.']]
]
// One entry per week of a 41-week school year.
const schoolEntries: Entry[] = Array.from({ length: 41 }, (_, i) => {
  const [focus, verse, points] = SCHOOL_FOCUSES[i % SCHOOL_FOCUSES.length]!
  return { title: `Week ${i + 1}: ${focus}`, intro: 'Thank you for praying for the school this week. Pray on your own, or with another parent at drop-off.', verse, points }
})

const CHURCH_PARTNERS = ['our partners in Lima, Peru', 'our team in Chiang Mai, Thailand', 'our church planters in Lyon, France', 'our medical workers in Nairobi, Kenya']
const CHURCH_ASPECTS: [string, Verse, (who: string) => string[]][] = [
  ['their walk with God', V.keep, who => [`Pray for ${who} to stay close to Jesus.`, 'Pray for time in the Word and in prayer that is not squeezed out by the work.']],
  ['open doors', V.door, who => [`Pray that God would open a door for the word for ${who}.`, 'Pray for one conversation this week that goes deeper.']],
  ['workers alongside them', V.harvest, who => [`Pray for more workers to join ${who}.`, 'Pray for someone from our own church to go.']],
  ['those who have not heard', V.heard, who => [`Pray for the people ${who} meet who have never heard the gospel.`, 'Pray for the Spirit to prepare hearts.']],
  ['the local church', V.church, who => [`Pray for the believers ${who} serve alongside.`, 'Pray for local leaders to be raised up.']],
  ['the word going out', V.speed, who => [`Pray that the word of the Lord would speed ahead through ${who}.`, 'Pray for health, family and daily needs.']]
]
// 26 weeks: a different partner each week, a new aspect each month.
const churchEntries: Entry[] = Array.from({ length: 26 }, (_, i) => {
  const who = CHURCH_PARTNERS[i % CHURCH_PARTNERS.length]!
  const [aspect, verse, points] = CHURCH_ASPECTS[Math.floor(i / CHURCH_PARTNERS.length) % CHURCH_ASPECTS.length]!
  return {
    title: `Week ${i + 1}: ${who.replace(/^our /, 'Our ')}`,
    intro: `This week we pray for ${who}, and for ${aspect}. A way to pray: read the verse aloud, thank God for what it says about him, then ask him to do it for the people you are praying for.`,
    verse,
    points: points(who)
  }
})

const RHYTHM_WEEKS: [string, Verse, string[]][] = [
  ['The church {in_place}', V.church, ['Thank God for the believers {of_place}.', 'Pray for them to stand firm and to love their neighbours.']],
  ['Our teams', V.door, ['Pray for the teams serving {in_place}: health, unity and open doors.', 'Pray for language learning and deep friendships.']],
  ['Places with no team yet', V.harvest, ['Pray for the towns and peoples {of_place} where nobody is working yet.', 'Ask the Lord of the harvest to send workers.']],
  ['Those who lead', V.leaders, ['Pray for those in authority {in_place}.', 'Pray for peace and for freedom to worship.']],
  ['Families', V.children, ['Pray for parents and children {in_place}.', 'Pray for whole households to come to faith.']],
  ['Young people', V.youth, ['Pray for students and young workers {in_place}.', 'Pray for young believers to set an example.']],
  ['The Word', V.speed, ['Pray for Scripture in the languages {of_place}.', 'Pray for those hearing or reading it for the first time.']],
  ['Peace', V.refuge, ['Pray for an end to violence and for the displaced to return home.', 'Pray for believers to be peacemakers.']],
  ['Daily bread', V.fearNot, ['Pray for rain, harvests and work {in_place}.', 'Pray for those who serve the poor and the sick.']],
  ['New believers', V.keep, ['Pray for new followers of Jesus {in_place}, especially those who face pressure from family.', 'Pray for someone to walk with each of them.']],
  ['Those who have never heard', V.heard, ['Pray for the people {of_place} who have never heard the gospel.', 'Pray for radio, video and personal witness to reach them.']],
  ['The glory of God', V.glory, ['Pray that {place} would be filled with the knowledge of the glory of the Lord.', 'Thank God for how he has answered these twelve weeks of prayer.']]
]
const rhythmEntries: Entry[] = RHYTHM_WEEKS.map(([focus, verse, points], i) => ({
  title: `Week ${i + 1}: ${focus}`,
  intro: 'Across our whole network we pray the same rhythm, each site for its own country. This week\'s focus for {place}:',
  verse,
  points
}))

// ── Seeding ────────────────────────────────────────────────────────────────

type Content =
  | { platform: string[] }
  | { library: string }
  | { own: { title: string, cadence?: Cadence, entries: Entry[] } }

interface CampaignSeed {
  slug: string
  name: string
  template?: string
  kind?: CampaignKind
  start_mode?: StartMode
  start_date?: string
  end_mode?: EndMode
  end_date?: string
  goal: Goal
  goal_target?: number
  cadence?: Cadence
  place?: string
  place_wording?: SitePlaceWording
  latitude?: number
  longitude?: number
  subtitle: Record<string, string>
  why?: Record<string, string>
  hero?: boolean
  draft?: boolean
  ended?: boolean
  end_message?: string
  cta?: CampaignCta
  relaunch_of?: string
  content?: Content
  // Edits week 1 of a followed library, which gives the site its own frozen copy.
  editFirstEntry?: Entry
  stories?: { name: string, body: string }[]
  intercessors?: IntercessorSeed
}

interface IntercessorSeed {
  // Ranges [from, to) of people (see `person`). Ranges shared between
  // campaigns and sites are the same people praying in several places.
  people: [number, number][]
  // App installs: no email, reminders on the phone.
  app?: number
  // 24/7 campaigns: the share of the day's slots that recurring prayer times fill.
  coverage?: number
}

interface SiteSeed {
  slug: string
  name: string
  timezone: string
  languages: string[]
  color: string
  campaigns: (today: string) => CampaignSeed[]
}

const text = (values: Record<string, string>): TranslatableText => ({ source: Object.keys(values)[0]!, values, stale: [] })

// The first of the named platform libraries that exists.
async function platformLibrary(titles: string[]) {
  for (const title of titles) {
    const lib = await db.selectFrom('pt_library').select(['id', 'title', 'cadence']).where('owner_user_id', 'is', null).where('title', '=', title).where('visibility', '=', 'published').executeTakeFirst()
    if (lib) return lib
  }
  return null
}

// A champion's own library, published for their sites and offered to Prayer.Tools to share with everyone.
async function ownerLibrary(title: string, description: string, cadence: Cadence, entries: Entry[]): Promise<string | null> {
  if (!owner) return null
  const existing = await db.selectFrom('pt_library').select('id').where('owner_user_id', '=', owner.id).where('title', '=', title).executeTakeFirst()
  if (existing) return existing.id
  const now = new Date()
  const lib = await db.insertInto('pt_library').values({
    owner_user_id: owner.id, title, description, cadence, entry_count: entries.length, languages: pgArray(['en']), source_language: 'en',
    topics: pgArray(['unreached']), license: 'own', credit: 'Sahel Partners', published_version: 1, published_at: now,
    share_status: 'requested', share_requested_at: now, rights_confirmed: true
  }).returning('id').executeTakeFirstOrThrow()
  await db.insertInto('pt_library_entry').values(entries.map((e, i) => {
    const doc = prayerDoc(e)
    return { library_id: lib.id, day: i + 1, language: 'en', draft: jsonb(doc), published: jsonb(doc), published_version: 1 }
  })).execute()
  return lib.id
}

// `orgId` narrows the site's own rows: this connection bypasses RLS.
async function addContent(tx: Tx, orgId: string, campaignId: string, c: CampaignSeed, cadence: Cadence) {
  const content = c.content
  if (!content) return
  let siteLibraryId: string
  if ('own' in content) {
    siteLibraryId = (await tx.insertInto('pt_site_library').values({ library_id: null, title: content.own.title, cadence: content.own.cadence ?? cadence }).returning('id').executeTakeFirstOrThrow()).id
    await tx.insertInto('pt_site_entry').values(content.own.entries.map((e, i) => ({ site_library_id: siteLibraryId, day: i + 1, language: 'en', content: jsonb(prayerDoc(e)), edited: true }))).execute()
  } else {
    const lib = 'platform' in content
      ? await platformLibrary(content.platform)
      : await tx.selectFrom('pt_library').select(['id', 'title', 'cadence']).where('id', '=', content.library).executeTakeFirst()
    if (!lib) return console.warn(`  no library for ${c.name}: ${'platform' in content ? content.platform.join(', ') : content.library}`)
    const existing = await tx.selectFrom('pt_site_library').select('id').where('org_id', '=', orgId).where('library_id', '=', lib.id).executeTakeFirst()
    siteLibraryId = existing?.id ?? (await tx.insertInto('pt_site_library').values({ library_id: lib.id, title: lib.title, cadence: lib.cadence }).returning('id').executeTakeFirstOrThrow()).id
    if (c.editFirstEntry) {
      const published = await tx.selectFrom('pt_library_entry').select(['day', 'language', 'published']).where('library_id', '=', lib.id).where('published', 'is not', null).execute()
      await tx.insertInto('pt_site_entry').values(published.map(e => e.day === 1 && e.language === 'en'
        ? { site_library_id: siteLibraryId, day: 1, language: 'en', content: jsonb(prayerDoc(c.editFirstEntry!)), edited: true }
        : { site_library_id: siteLibraryId, day: e.day, language: e.language, content: jsonb(e.published as TiptapDoc), edited: false })).execute()
      await tx.updateTable('pt_site_library').set({ frozen_version: 1 }).where('id', '=', siteLibraryId).execute()
    }
  }
  await tx.insertInto('pt_campaign_library').values({ campaign_id: campaignId, site_library_id: siteLibraryId, position: 0 }).execute()
}

async function site(seed: SiteSeed) {
  const existing = await db.selectFrom('orgs').select('id').where('slug', '=', seed.slug).executeTakeFirst()
  if (existing) console.log(`site ${seed.slug} exists`)
  const orgId = existing?.id ?? await createSite(seed)
  await addIntercessors(seed, orgId)
}

async function createSite(seed: SiteSeed): Promise<string> {
  const now = new Date()
  const org = await db.insertInto('orgs').values({ slug: seed.slug, name: seed.name, created_at: now, updated_at: now }).returning('id').executeTakeFirstOrThrow()
  await enableSiteApps(db, org.id)
  if (owner) await db.insertInto('memberships').values({ user_id: owner.id, org_id: org.id, roles: sql`'{admin}'::text[]`, created_at: now, updated_at: now }).execute()
  const defaultLanguage = seed.languages[0]!
  const hero = heroImagesFor('ramadan')[0]
  await withOrg(db, org.id, async (tx) => {
    await tx.insertInto('pt_site').values({
      org_id: org.id, status: 'published', languages: pgArray(seed.languages), default_language: defaultLanguage, timezone: seed.timezone,
      branding: jsonb({ color: seed.color }), onboarding: jsonb({ completed: true }), published_at: now
    }).execute()
    const ids = new Map<string, string>()
    for (const c of seed.campaigns(todayIn(seed.timezone))) {
      const cadence = c.cadence ?? 'daily'
      const created = await tx.insertInto('pt_campaign').values({
        slug: c.slug, name: c.name, template_key: c.template ?? 'generic', kind: c.kind ?? null,
        start_mode: c.start_mode ?? 'date', start_date: c.start_date ?? null, end_mode: c.end_mode ?? 'date', end_date: c.end_date ?? null, length_days: null,
        goal: c.goal, goal_target: c.goal_target ?? null, cadence, track_time: true, timezone: seed.timezone,
        place_name: c.place ?? null, place_wording: jsonb(c.place_wording ?? {}), latitude: c.latitude ?? null, longitude: c.longitude ?? null,
        description: jsonb(text(c.subtitle)),
        landing: jsonb({ subtitle: text(c.subtitle), ...(c.why ? { why: Object.fromEntries(Object.entries(c.why).map(([lang, t]) => [lang, textDoc(t)])) } : {}) }),
        branding: jsonb(c.hero && hero ? { image_url: hero.url } : {}),
        end_message: c.end_message ? jsonb(text({ [defaultLanguage]: c.end_message })) : null,
        cta: jsonb(c.cta ?? {}),
        relaunch_of: c.relaunch_of ? ids.get(c.relaunch_of)! : null,
        published_at: c.draft ? null : now,
        ended_at: c.ended && c.end_date ? new Date(`${addDays(c.end_date, 1)}T06:00:00Z`) : null
      }).returning('id').executeTakeFirstOrThrow()
      ids.set(c.slug, created.id)
      // A relaunch keeps the libraries of the campaign it was relaunched from.
      const from = c.relaunch_of ? ids.get(c.relaunch_of)! : null
      if (from) {
        const libs = await tx.selectFrom('pt_campaign_library').select(['site_library_id', 'position']).where('campaign_id', '=', from).execute()
        if (libs.length) await tx.insertInto('pt_campaign_library').values(libs.map(l => ({ campaign_id: created.id, site_library_id: l.site_library_id, position: l.position }))).execute()
      } else {
        await addContent(tx, org.id, created.id, c, cadence)
      }
      for (const s of c.stories ?? []) {
        await tx.insertInto('pt_story').values({
          campaign_id: created.id, name: s.name, body: s.body, language: defaultLanguage, may_publish: true, use_name: true,
          wording_version: CONSENT_WORDING_VERSION, published: true, published_at: now
        }).execute()
      }
    }
  })
  console.log(`seeded site ${seed.slug}: ${siteAddress(seed.slug)}`)
  return org.id
}

// ── Intercessors ───────────────────────────────────────────────────────────

const FIRST_NAMES = [
  'Anna', 'David', 'Maria', 'John', 'Sarah', 'Daniel', 'Ruth', 'Samuel', 'Esther', 'Paul', 'Grace', 'Peter', 'Hannah', 'Mark', 'Lydia', 'Thomas',
  'Camille', 'Julien', 'Sophie', 'Luc', 'Ana', 'Mateo', 'Lucia', 'Pedro', 'Amina', 'Kwame', 'Ngozi', 'Tunde', 'Mei', 'Jin', 'Priya', 'Arjun',
  'Leila', 'Karim', 'Nadia', 'Omar', 'Ingrid', 'Lars', 'Freya', 'Jonas', 'Rebecca', 'Caleb', 'Naomi', 'Joel', 'Miriam', 'Isaac', 'Abigail'
]
const LAST_NAMES = [
  'Martin', 'Dubois', 'Smith', 'Johnson', 'Garcia', 'Silva', 'Okafor', 'Mensah', 'Kim', 'Chen', 'Patel', 'Thomas', 'Haddad', 'Nasser', 'Larsen', 'Berg',
  'Müller', 'Rossi', 'Novak', 'Kowalski', 'Wright', 'Clark', 'Lopez', 'Santos', 'Banda', 'Otieno', 'Tanaka', 'Singh', 'Reyes', 'Fischer', 'Moreau', 'Lambert',
  'Carter', 'Hughes', 'Tran', 'Nguyen', 'Evans', 'Bauer', 'Costa', 'Petrov', 'Hall'
]
const GLOBAL_ZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto', 'America/Sao_Paulo', 'America/Bogota',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Africa/Lagos', 'Africa/Nairobi', 'Africa/Johannesburg',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Manila', 'Asia/Seoul', 'Asia/Singapore', 'Australia/Sydney', 'Pacific/Auckland'
]
// The school's and the church's people live in one town.
const LOCAL_ZONES = ['America/Chicago', 'America/Chicago', 'America/Chicago', 'America/Chicago', 'America/Chicago', 'America/Chicago', 'America/New_York', 'America/Denver']
const LOCAL_PEOPLE: [number, number] = [600, 720]

// A repeatable random number generator, so a campaign gets the same people and times on every run.
function seeded(key: string): () => number {
  let a = 2166136261
  for (const ch of key) a = Math.imul(a ^ ch.charCodeAt(0), 16777619)
  return () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = <T>(rng: () => number, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!

// Person number `i`: the same name, address and timezone wherever they pray.
function person(i: number) {
  const first = FIRST_NAMES[i % FIRST_NAMES.length]!
  const last = LAST_NAMES[i % LAST_NAMES.length]!
  const ascii = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const local = i >= LOCAL_PEOPLE[0] && i < LOCAL_PEOPLE[1]
  return { name: `${first} ${last}`, email: `${ascii(first)}.${ascii(last)}@example.com`, timezone: pick(seeded(`person/${i}`), local ? LOCAL_ZONES : GLOBAL_ZONES) }
}

// A quarter-hour time of day, mostly early morning or evening.
function prayerTime(rng: () => number): string {
  const r = rng()
  const hour = r < 0.45 ? 5 + Math.floor(rng() * 4) : r < 0.75 ? 19 + Math.floor(rng() * 4) : Math.floor(rng() * 24)
  return `${String(hour).padStart(2, '0')}:${pick(rng, ['00', '15', '30', '45'])}`
}

// The day someone signed up: for an ended campaign mostly in the two weeks
// before it started and the rest in its first week, in the last two weeks for
// an upcoming one, any time since signup opened for a running one.
function joinDay(c: CampaignRow, status: 'upcoming' | 'active' | 'ended', today: string, rng: () => number): string {
  if (c.start_mode === 'join') return addDays(today, -Math.floor(rng() * 25))
  const start = c.start_date!
  if (status === 'ended') return rng() < 0.85 ? addDays(start, -1 - Math.floor(rng() * 14)) : addDays(start, Math.floor(rng() * Math.min(7, daysBetween(start, c.end_date!))))
  if (status === 'upcoming') return addDays(today, -Math.floor(rng() * 15))
  return addDays(today, -Math.floor(rng() * (daysBetween(start, today) + 10)))
}

// Hands out the 96 quarter-hour slots of a 24/7 day (in UTC) one after another
// until `share` of them are taken, then at random, so later people overlap.
function slotPlan(share: number, rng: () => number) {
  const free = Array.from({ length: 96 }, (_, i) => i)
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[free[i], free[j]] = [free[j]!, free[i]!]
  }
  const taken = new Set<number>()
  return (slots: number): number => {
    while (free.length && taken.has(free[0]!)) free.shift()
    const first = taken.size < share * 96 && free.length ? free[0]! : Math.floor(rng() * 96)
    for (let k = 0; k < slots; k++) taken.add((first + k) % 96)
    return first
  }
}

// One person's prayer time in a campaign, of the kind its goal asks for.
function prayerRule(c: CampaignRow, timezone: string, rng: () => number, nextSlot: ((slots: number) => number) | null): RuleInput {
  if (c.goal === 'coverage' && nextSlot) {
    const duration_min = pick(rng, durationOptions(c).filter(d => d <= 60).flatMap(d => d === 15 ? [d, d, d] : d === 30 ? [d, d] : [d]))
    const first = nextSlot(duration_min / 15)
    const at = (day: number) => new Date(Date.parse(`${addDays(c.start_date!, day)}T00:00:00Z`) + first * 15 * 60_000)
    // One in ten picks specific dates in place of a time every day.
    if (rng() < 0.1) {
      const days = daysBetween(c.start_date!, c.end_date!) - 1
      const picked = [...new Set(Array.from({ length: 6 + Math.floor(rng() * 7) }, () => 1 + Math.floor(rng() * days)))].sort((a, b) => a - b)
      return { kind: 'dates', time: localTimeOf(at(picked[0]!), timezone), timezone, duration_min, dates: picked.map(d => at(d).toISOString()) }
    }
    return { kind: 'recurring', frequency: 'daily', time: localTimeOf(at(0), timezone), timezone, duration_min }
  }
  const duration_min = c.goal === 'prayer_time' ? pick(rng, [10, 15, 15, 15, 20, 30, 30, 60]) : rng() < 0.6 ? pick(rng, [10, 15, 15, 20, 30]) : null
  if (c.cadence === 'weekly' && rng() < 0.55) {
    const days_of_week = [...new Set(Array.from({ length: 1 + Math.floor(rng() * 3) }, () => Math.floor(rng() * 7)))]
    return { kind: 'recurring', frequency: 'weekly', days_of_week, time: prayerTime(rng), timezone, duration_min }
  }
  return { kind: 'recurring', frequency: 'daily', time: prayerTime(rng), timezone, duration_min }
}

const instantOn = (day: string, rng: () => number) => new Date(Math.min(Date.parse(`${day}T00:00:00Z`) + Math.floor(rng() * 86_400_000), Date.now() - 60_000))

// Moves the prayer time someone just added back to the day they joined. In a
// start-anytime campaign it also records how far they have got.
async function backdateCommitment(tx: Tx, sub: SubscriptionRow, c: CampaignRow, joined: string, joinedAt: Date, entries: number | null, today: string, rng: () => number): Promise<{ id: string, finished: boolean }> {
  const row = await tx.selectFrom('pt_commitment').select('id').where('subscription_id', '=', sub.id).where('campaign_id', '=', c.id).orderBy('created_at', 'desc').executeTakeFirstOrThrow()
  let progress = {}
  let finished = false
  if (c.start_mode === 'join') {
    const done = Math.max(0, Math.min(entries ?? 0, daysBetween(joined, today) + 1 - Math.floor(rng() * 4)))
    const advanced = done ? addDays(today, -Math.floor(rng() * 2)) : null
    finished = !!entries && done >= entries
    progress = { entries_done: done, advanced_on: advanced, finished_at: finished ? new Date(`${advanced}T12:00:00Z`) : null }
  }
  const starts_on = c.start_mode === 'join' || joined > c.start_date! ? joined : c.start_date!
  await tx.updateTable('pt_commitment').set({ starts_on, created_at: joinedAt, updated_at: joinedAt, ...progress }).where('id', '=', row.id).execute()
  return { id: row.id, finished }
}

async function addIntercessors(seed: SiteSeed, orgId: string) {
  const today = todayIn(seed.timezone)
  for (const spec of seed.campaigns(today)) {
    const plan = spec.intercessors
    if (!plan) continue
    const added = await withOrg(app, orgId, async (tx) => {
      const c = (await loadCampaigns(tx)).find(k => k.slug === spec.slug)
      if (!c) return null
      if (await tx.selectFrom('pt_commitment').select('id').where('campaign_id', '=', c.id).limit(1).executeTakeFirst()) return null
      const status = campaignStatus(c)
      const rng = seeded(`${seed.slug}/${spec.slug}`)
      const entries = c.start_mode === 'join' ? await campaignEntries(tx, c) : null
      const nextSlot = c.goal === 'coverage' ? slotPlan(plan.coverage ?? 0.5, rng) : null
      const ongoing = c.end_mode === 'none'
      const stats = new Map<string, number>()
      const count = (day: string, metric: Metric) => stats.set(`${day} ${metric}`, (stats.get(`${day} ${metric}`) ?? 0) + 1)
      const referrals: string[] = []
      let people = 0

      for (const i of plan.people.flatMap(([from, to]) => Array.from({ length: to - from }, (_, k) => from + k))) {
        const who = person(i)
        const language = rng() < 0.6 ? seed.languages[0]! : pick(rng, seed.languages)
        const rule = prayerRule(c, who.timezone, rng, nextSlot)
        const errors = validateRuleForCampaign(rule, c)
        if (errors.length) throw new Error(`${seed.slug}/${spec.slug}: invalid prayer time (${errors.join(', ')})`)
        // A few have not confirmed their address yet; they signed up in the last days.
        const unconfirmed = status !== 'ended' && rng() < 0.06
        const joined = unconfirmed ? addDays(today, -Math.floor(rng() * 3)) : joinDay(c, status, today, rng)
        const joinedAt = instantOn(joined, rng)
        const res = await createWebSignup(tx, {
          campaign: c, email: who.email, name: who.name, language, timezone: who.timezone, commitments: [rule],
          consents: { siteUpdates: rng() < 0.7 },
          referredBy: referrals.length && rng() < 0.15 ? pick(rng, referrals) : null,
          preVerified: !unconfirmed,
          capture: { surface: 'web_signup', source: `${seed.slug}.${baseHost}`, language }
        })
        const sub = res.subscription
        const confirmedAt = new Date(joinedAt.getTime() + 4 * 60_000)
        if (res.newSubscription) {
          await tx.updateTable('pt_subscription').set({ created_at: joinedAt, ...(sub.verified_at ? { verified_at: confirmedAt } : {}) }).where('id', '=', sub.id).execute()
          count(joined, 'signups')
          if (sub.verified_at) count(joined, 'verifications')
          if (sub.referred_by) count(joined, 'share_signups')
          referrals.push(sub.referral_code)
        } else {
          await tx.updateTable('pt_subscription').set({
            created_at: sql`least(created_at, ${joinedAt}::timestamptz)`,
            ...(sub.verified_at ? { verified_at: sql`least(verified_at, ${confirmedAt}::timestamptz)` } : {})
          }).where('id', '=', sub.id).execute()
        }
        const commitment = await backdateCommitment(tx, sub, c, joined, joinedAt, entries, today, rng)
        await refreshReminders(tx, sub.id)
        people++
        if (commitment.finished) {
          await setSubscriptionStatus(tx, sub.id, 'completed')
        } else if (res.newSubscription && sub.verified_at && status !== 'ended') {
          const r = rng()
          if (r < 0.04) await setSubscriptionStatus(tx, sub.id, 'unsubscribed')
          else if (r < 0.08 && ongoing) await setSubscriptionStatus(tx, sub.id, 'inactive')
          else if (r < 0.13) await updateCommitment(tx, sub, commitment.id, { paused: true })
        }
      }

      const site = await tx.selectFrom('pt_site').select('default_language').executeTakeFirstOrThrow()
      for (let k = 0; k < (plan.app ?? 0); k++) {
        const timezone = pick(rng, GLOBAL_ZONES)
        const joined = joinDay(c, status, today, rng)
        const joinedAt = instantOn(joined, rng)
        const sub = await tx.insertInto('pt_subscription').values({
          user_id: await createAnonymousAccount(tx), delivery: 'app', language: site.default_language, timezone,
          referral_code: shortCode(6), last_activity_at: new Date(), checkin_cycle_started_at: new Date(), created_at: joinedAt
        }).returningAll().executeTakeFirstOrThrow()
        await insertCommitment(tx, sub, c, prayerRule(c, timezone, rng, nextSlot))
        const commitment = await backdateCommitment(tx, sub, c, joined, joinedAt, entries, today, rng)
        if (commitment.finished) await setSubscriptionStatus(tx, sub.id, 'completed')
        people++
      }

      // Signups count on the day each person joined.
      await tx.deleteFrom('pt_stat_daily').where('campaign_id', '=', c.id).where('metric', 'in', ['signups', 'verifications', 'share_signups']).execute()
      for (const [key, n] of stats) {
        const [day, metric] = key.split(' ') as [string, Metric]
        await bumpStat(tx, c.id, day, metric, n)
      }
      return people
    })
    if (added !== null) console.log(`  ${seed.slug}/${spec.slug}: ${added} intercessors`)
  }
}

const RAMADAN_LIBRARIES = ['Ramadan 2026', 'Ramadan 2025', 'Ramadan 30 days (sample)']
const ramadanStart = (today: string) => suggestedStartDate('ramadan', today) ?? addDays(today, 60)

// Use cases 1 and 2: an ongoing country site, with side campaigns that are
// over (a crisis), running (a short-term team's visit), upcoming (Ramadan)
// and still a draft (an election).
await site({
  slug: 'pray-france', name: 'Pray for France', timezone: 'Europe/Paris', languages: ['en', 'fr'], color: '#1d4e89',
  campaigns: (today): CampaignSeed[] => {
    const ramadan = ramadanStart(today)
    return [
      {
        slug: addDays(today, -60).slice(0, 4), name: 'Pray for France', start_date: addDays(today, -60), end_mode: 'none', goal: 'people', goal_target: 500,
        place: 'France', place_wording: { fr: { name: 'la France', in: 'en France', of: 'de la France' } }, latitude: 46.6, longitude: 2.4,
        subtitle: { en: 'Pray through France, one region a week.', fr: 'Priez pour la France, une région par semaine.' },
        why: {
          en: 'Most people in France have never read the Bible or met a follower of Jesus who explained the gospel to them, and many towns have no evangelical church.\n\nWe pray through the country one region at a time, a different focus each day, asking God to build his church and send workers.',
          fr: 'La plupart des Français n\'ont jamais lu la Bible ni rencontré un disciple de Jésus qui leur ait expliqué l\'Évangile, et beaucoup de villes n\'ont pas d\'église évangélique.\n\nNous prions pour le pays une région à la fois, avec un sujet différent chaque jour, en demandant à Dieu de bâtir son Église et d\'envoyer des ouvriers.'
        },
        content: { own: { title: 'Praying through the regions of France', entries: franceEntries } },
        stories: [{ name: 'Claire', body: 'I started praying for Brittany because my grandmother was born there. Three months later I am in touch with a church plant in Rennes and our home group prays for them every week.' }],
        intercessors: { people: [[0, 120]], app: 9 }
      },
      {
        slug: `floods-${addDays(today, -40).slice(0, 4)}`, name: 'Flood response', template: 'disaster_4', kind: 'side', start_date: addDays(today, -40), end_date: addDays(today, -37), ended: true, goal: 'people',
        place: 'the south of France', latitude: 43.6, longitude: 3.9,
        subtitle: { en: 'Four days of prayer for the towns hit by the floods.', fr: 'Quatre jours de prière pour les villes touchées par les inondations.' },
        end_message: 'Thank you for praying with us through these four days. Churches in the area were able to open their halls and serve hundreds of meals.',
        content: { platform: ['4-Day Crisis'] },
        stories: [{ name: 'Marc', body: 'Our church hall became a shelter for a week. Knowing people across the country were praying each day kept our volunteers going.' }],
        // Thirty were already praying in the main campaign.
        intercessors: { people: [[90, 135]] }
      },
      {
        slug: `paris-team-${addDays(today, -3).slice(0, 4)}`, name: 'Paris outreach team', kind: 'side', start_date: addDays(today, -3), end_date: addDays(today, 10), goal: 'prayer_time', goal_target: 480,
        place: 'Paris', latitude: 48.86, longitude: 2.35,
        subtitle: { en: 'Two weeks of prayer while a short-term team serves in Paris.', fr: 'Deux semaines de prière pendant qu\'une équipe sert à Paris.' },
        why: { en: 'A team of twelve is serving alongside a church in the north of Paris for two weeks. Pray with them each day: for open doors, for unity and for the people they meet.' },
        content: { own: { title: 'Paris team prayer guide', entries: teamEntries } },
        intercessors: { people: [[20, 32]] }
      },
      {
        slug: `ramadan-${ramadan.slice(0, 4)}`, name: `Ramadan ${ramadan.slice(0, 4)}`, template: 'ramadan', kind: 'side', start_date: ramadan, end_date: addDays(ramadan, 29), goal: 'coverage',
        place: 'France', place_wording: { fr: { name: 'la France', in: 'en France', of: 'de la France' } }, latitude: 46.6, longitude: 2.4, hero: true,
        subtitle: { en: '30 days of 24/7 prayer for Muslims in France.', fr: '30 jours de prière 24h/24 pour les musulmans de France.' },
        content: { platform: RAMADAN_LIBRARIES },
        intercessors: { people: [[105, 133]], coverage: 0.3 }
      },
      {
        slug: `election-${addDays(today, 45).slice(0, 4)}`, name: 'Election week of prayer', kind: 'side', draft: true, start_date: addDays(today, 45), end_date: addDays(today, 51), goal: 'people',
        place: 'France', latitude: 46.6, longitude: 2.4,
        subtitle: { en: 'A week of prayer for the nation as it votes.' }
      }
    ]
  }
})

// Use case 3: a yearly Ramadan site, between last year's run and the next.
await site({
  slug: 'ramadan-morocco', name: 'Pray for Morocco', timezone: 'Africa/Casablanca', languages: ['en', 'fr', 'ar'], color: '#8a3324',
  campaigns: (today) => {
    const next = ramadanStart(today)
    const previous = '2026-02-18' < today ? '2026-02-18' : addDays(today, -300)
    const wording = { fr: { name: 'le Maroc', in: 'au Maroc', of: 'du Maroc' }, ar: { name: 'المغرب', in: 'في المغرب' } }
    const base = { template: 'ramadan', goal: 'coverage' as const, place: 'Morocco', place_wording: wording, latitude: 31.8, longitude: -7.1, hero: true }
    return [
      {
        ...base, slug: previous.slice(0, 4), name: `Ramadan ${previous.slice(0, 4)}`, start_date: previous, end_date: addDays(previous, 29), ended: true,
        subtitle: { en: '30 days of 24/7 prayer for Morocco during Ramadan.', fr: '30 jours de prière 24h/24 pour le Maroc pendant le Ramadan.', ar: '٣٠ يومًا من الصلاة المتواصلة من أجل المغرب في رمضان.' },
        end_message: 'Thank you for praying for Morocco through Ramadan. Together we covered most of the month in prayer, day and night. We will run again next year.',
        content: { platform: RAMADAN_LIBRARIES },
        stories: [{ name: 'Youssef', body: 'I took the 3 a.m. slot for the whole month. It changed how I pray for my own family.' }],
        intercessors: { people: [[200, 310]], coverage: 0.97 }
      },
      {
        ...base, slug: next.slice(0, 4), name: `Ramadan ${next.slice(0, 4)}`, start_date: next, end_date: addDays(next, 29), relaunch_of: previous.slice(0, 4),
        subtitle: { en: '30 days of 24/7 prayer for Morocco during Ramadan.', fr: '30 jours de prière 24h/24 pour le Maroc pendant le Ramadan.', ar: '٣٠ يومًا من الصلاة المتواصلة من أجل المغرب في رمضان.' },
        // Mostly last year's intercessors coming back.
        intercessors: { people: [[275, 313]], app: 4, coverage: 0.4 }
      }
    ]
  }
})

// Crisis response: a 4-day campaign running now, handing people on to a
// 12-day campaign through its call to action.
await site({
  slug: 'pray-mozambique', name: 'Pray for Mozambique', timezone: 'Africa/Maputo', languages: ['en'], color: '#b45309',
  campaigns: (today) => {
    const year = addDays(today, -1).slice(0, 4)
    const base = { goal: 'people' as const, place: 'Mozambique', latitude: -18.7, longitude: 35.5 }
    return [
      {
        ...base, slug: year, name: 'Cyclone response: 4 days of prayer', template: 'disaster_4', start_date: addDays(today, -1), end_date: addDays(today, 2),
        subtitle: { en: 'Four days of prayer for those hit by the cyclone.' },
        why: { en: 'A cyclone has left thousands without homes, clean water or food. Before anything else, we pray.' },
        end_message: 'Thank you for praying through these first four days. The need goes on: join us for twelve more days of prayer.',
        cta: { label: text({ en: 'Join the 12 days of prayer' }), url: `${siteAddress('pray-mozambique')}/${year}-2/signup` },
        content: { platform: ['4-Day Crisis'] },
        intercessors: { people: [[400, 485]], app: 6 }
      },
      {
        ...base, slug: `${year}-2`, name: '12 days of prayer for Mozambique', template: 'disaster_12', start_date: addDays(today, 3), end_date: addDays(today, 14),
        subtitle: { en: 'Twelve days of prayer as the response moves from rescue to recovery.' },
        why: { en: 'The cameras leave, the need stays. For twelve days we pray for shelter, water, health and hope as communities begin to rebuild.' },
        content: { own: { title: '12 days of prayer after the cyclone', entries: crisisEntries } },
        // Those who took the 4-day campaign's call to action, and a few new people.
        intercessors: { people: [[455, 490]] }
      }
    ]
  }
})

// Start anytime: a devotional each person starts on day 1 the day they join.
await site({
  slug: 'ten-days', name: '10 Days for the Unreached', timezone: 'UTC', languages: ['en'], color: '#4d7c0f',
  campaigns: today => [{
    slug: today.slice(0, 4), name: '10 Days for the Unreached', template: 'anytime', start_mode: 'join', end_mode: 'days', goal: 'people',
    subtitle: { en: 'Ten days of prayer for peoples with no access to the gospel. Start today.' },
    why: { en: 'Billions of people live where there is no church and no one to tell them about Jesus. Start whenever you like: each day for ten days you get one people or place to pray for.' },
    content: { platform: ['10 Days for the Unreached'] },
    // Some also pray for France.
    intercessors: { people: [[100, 120], [500, 540]], app: 12 }
  }]
})

// School: weekly content through the school year, one time zone.
await site({
  slug: 'oakridge-school', name: 'Pray for Oakridge School', timezone: 'America/Chicago', languages: ['en'], color: '#6d28d9',
  campaigns: (today) => {
    // The Monday twelve weeks back.
    const start = addDays(today, -84 - ((weekdayOf(today) + 6) % 7))
    return [{
      slug: start.slice(0, 4), name: 'School year of prayer', start_date: start, end_date: addDays(start, schoolEntries.length * 7 - 1), cadence: 'weekly', goal: 'people', goal_target: 100,
      place: 'Oakridge School',
      subtitle: { en: 'Staff and parents praying for our school, every week of the school year.' },
      why: { en: 'We believe God cares about every student, teacher and family at Oakridge. Each week of the school year we send one thing to pray for. It takes five minutes, on your own or with another parent.' },
      content: { own: { title: 'School year prayer guide', entries: schoolEntries } },
      intercessors: { people: [[600, 646]] }
    }]
  }
})

// Church: a few partners in different places, a network in one time zone,
// aiming for 24 hours of prayer every day.
await site({
  slug: 'grace-church', name: 'Grace Church Prays', timezone: 'America/Chicago', languages: ['en'], color: '#0f766e',
  campaigns: (today) => {
    const start = addDays(today, -21)
    return [{
      slug: start.slice(0, 4), name: 'Praying for our global partners', start_date: start, end_mode: 'none', cadence: 'weekly', goal: 'prayer_time',
      subtitle: { en: 'Together, 24 hours of prayer every day for the people our church has sent.' },
      why: { en: 'Our church supports partners in Peru, Thailand, France and Kenya. Each week we pray for one of them. Tell us how long you pray each day: together we are aiming for 24 hours of prayer every day, at whatever time suits you.' },
      content: { own: { title: 'Praying for our partners', entries: churchEntries } },
      // A few families are also school parents.
      intercessors: { people: [[640, 704]] }
    }]
  }
})

// Mission agency: one login, a site per country, all following the agency's
// own library. The Mali site has edited week 1, so it keeps its own copy.
const rhythmLibrary = await ownerLibrary(
  'Weekly prayer rhythm for the Sahel',
  'Twelve weeks of prayer for a country of the Sahel: its church, our teams, and the places nobody has gone yet.',
  'weekly',
  rhythmEntries
)
// Part of the agency's network prays for more than one of its countries.
const AGENCY_SITES: { slug: string, place: string, color: string, latitude: number, longitude: number, teams: string, people: [number, number], edit?: Entry }[] = [
  { slug: 'sahel-senegal', place: 'Senegal', color: '#15803d', latitude: 14.5, longitude: -14.5, people: [800, 834], teams: 'We have teams in two cities and are asking God for workers for the east of the country.' },
  {
    slug: 'sahel-mali', place: 'Mali', color: '#a16207', latitude: 17.6, longitude: -4.0, people: [820, 841], teams: 'We have one team in the capital and nobody yet in the north.',
    edit: { title: 'Week 1: The church in Mali', intro: 'This week churches across Mali hold their yearly week of prayer. We join them.', verse: V.church, points: ['Thank God for the believers of Mali and for their week of prayer.', 'Pray for pastors travelling between villages to arrive safely.', 'Pray for them to stand firm and to love their neighbours.'] }
  },
  { slug: 'sahel-niger', place: 'Niger', color: '#c2410c', latitude: 17.6, longitude: 8.1, people: [828, 837], teams: 'We have no team here yet. Pray with us for the first one.' }
]
for (const a of AGENCY_SITES) {
  await site({
    slug: a.slug, name: `Pray for ${a.place}`, timezone: 'Africa/Dakar', languages: ['en'], color: a.color,
    campaigns: (today) => {
      const start = addDays(today, -14)
      return [{
        slug: start.slice(0, 4), name: `Pray for ${a.place}`, start_date: start, end_mode: 'none', cadence: 'weekly', goal: 'people', goal_target: 200,
        place: a.place, latitude: a.latitude, longitude: a.longitude,
        subtitle: { en: `A weekly rhythm of prayer for ${a.place}, with Sahel Partners.` },
        why: { en: `Sahel Partners prays for every country of the Sahel, where we have teams and where nobody has gone yet. ${a.teams}\n\nEach week you get one focus for ${a.place}, the same rhythm our whole network prays.` },
        ...(rhythmLibrary ? { content: { library: rhythmLibrary }, editFirstEntry: a.edit } : {}),
        intercessors: { people: [a.people] }
      }]
    }
  })
}

await app.destroy()
await db.destroy()
