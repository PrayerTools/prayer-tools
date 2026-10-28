// Seeds local development data: a platform library and three sites (a
// published Ramadan campaign, a published 24/7 coverage campaign, a draft).
// Idempotent: sites that already exist only get their apps turned on.
// Usage: DATABASE_URL=… bun run scripts/seed-dev.ts
import { sql } from 'kysely'
import { createDb } from '@prayertools/shared/db/connect'
import { withOrg } from '@prayertools/shared/db/scope'
import { ensureSystemUser } from '@prayertools/shared/crm'
import { addDays, todayIn } from '@prayertools/shared/dates'
import { textDoc } from '@prayertools/shared/tiptap'
import { makeText } from '@prayertools/shared/translatable'
import { jsonb } from '@prayertools/shared/db/json'
import { enableSiteApps } from '@prayertools/shared/site'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')
const db = createDb(url)
await ensureSystemUser(db)

async function platformLibrary(): Promise<string> {
  const existing = await db.selectFrom('pt_library').select('id').where('title', '=', 'Ramadan 30 days (sample)').executeTakeFirst()
  if (existing) return existing.id
  const lib = await db
    .insertInto('pt_library')
    .values({
      owner_user_id: null, title: 'Ramadan 30 days (sample)', description: 'A daily prayer guide for the month of Ramadan.',
      cadence: 'daily', entry_count: 30, languages: sql`'{en,fr}'::text[]`, source_language: 'en', topics: sql`'{ramadan}'::text[]`,
      template_keys: sql`'{ramadan}'::text[]`, license: 'own', credit: 'Prayer.Tools', visibility: 'published', published_version: 1, published_at: new Date()
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  for (let day = 1; day <= 30; day++) {
    const en = {
      type: 'doc' as const,
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: `Day ${day}: pray for {place}` }] },
        { type: 'paragraph', content: [{ type: 'text', text: `Today we pray that the people of {place} would know God's love. This is day ${day} of {campaign_name}.` }] },
        { type: 'verse', attrs: { reference: 'John 3:16', translation: 'NIV' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'For God so loved the world that he gave his one and only Son.' }] }] },
        { type: 'bulletList', content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pray for families.' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pray for peace.' }] }] }
        ] }
      ]
    }
    const fr = textDoc(`Jour ${day} : priez pour {place}\n\nAujourd'hui, nous prions pour que les habitants de {place} connaissent l'amour de Dieu.`)
    await db.insertInto('pt_library_entry').values([
      { library_id: lib.id, day, language: 'en', draft: jsonb(en), published: jsonb(en), published_version: 1 },
      { library_id: lib.id, day, language: 'fr', draft: jsonb(fr), published: jsonb(fr), published_version: 1 }
    ]).execute()
  }
  return lib.id
}

interface SiteSeed {
  slug: string
  name: string
  status: 'draft' | 'published'
  languages: string[]
  place: string
  campaign: { name: string, goal: 'people' | 'coverage' | 'prayer_time', startOffset: number, days: number, template: string }
}

async function site(seed: SiteSeed, libraryId: string) {
  const existing = await db.selectFrom('orgs').select('id').where('slug', '=', seed.slug).executeTakeFirst()
  if (existing) {
    await enableSiteApps(db, existing.id)
    return console.log(`site ${seed.slug} exists`)
  }
  const org = await db.insertInto('orgs').values({ slug: seed.slug, name: seed.name, created_at: new Date(), updated_at: new Date() }).returning('id').executeTakeFirstOrThrow()
  await enableSiteApps(db, org.id)
  const owner = await db.selectFrom('users').select('id').where('id', '!=', '00000000-0000-4000-8000-000000000001').orderBy('created', 'asc').executeTakeFirst()
  if (owner) {
    await db.insertInto('memberships').values({ user_id: owner.id, org_id: org.id, roles: sql`'{admin}'::text[]`, created_at: new Date(), updated_at: new Date() }).execute()
  }
  const tz = 'America/New_York'
  const today = todayIn(tz)
  const start = addDays(today, seed.campaign.startOffset)
  await withOrg(db, org.id, async (tx) => {
    await tx.insertInto('pt_site').values({
      org_id: org.id,
      status: seed.status,
      description: jsonb(makeText('en', `Join us in praying for ${seed.place}.`)),
      purpose: 'place',
      languages: sql`${`{${seed.languages.join(',')}}`}::text[]`, default_language: seed.languages[0]!, timezone: tz,
      branding: jsonb({ color: '#2f6f5e' }),
      template_key: seed.campaign.template,
      published_at: seed.status === 'published' ? new Date() : null
    }).execute()
    const campaign = await tx.insertInto('pt_campaign').values({
      slug: start.slice(0, 4), name: seed.campaign.name, template_key: seed.campaign.template,
      start_mode: 'date', start_date: start, end_mode: 'date', end_date: addDays(start, seed.campaign.days - 1),
      goal: seed.campaign.goal, cadence: 'daily', timezone: tz, goal_target: seed.campaign.goal === 'people' ? 100 : null,
      place_name: seed.place, latitude: 33.5, longitude: 36.3,
      landing: jsonb({ why: { en: textDoc(`Why pray for ${seed.place}? Because every person matters to God.`) } })
    }).returning('id').executeTakeFirstOrThrow()
    const sl = await tx.insertInto('pt_site_library').values({ library_id: libraryId, title: 'Ramadan 30 days (sample)', cadence: 'daily' }).returning('id').executeTakeFirstOrThrow()
    await tx.insertInto('pt_campaign_library').values({ campaign_id: campaign.id, site_library_id: sl.id, position: 0 }).execute()
  })
  console.log(`seeded site ${seed.slug}`)
}

const libraryId = await platformLibrary()
await site({ slug: 'ramadan-demo', name: 'Pray for Damascus', status: 'published', languages: ['en', 'fr', 'ar'], place: 'Damascus', campaign: { name: 'Ramadan 2026', goal: 'people', startOffset: -5, days: 30, template: 'ramadan' } }, libraryId)
await site({ slug: 'demo-247', name: '24/7 for Beirut', status: 'published', languages: ['en'], place: 'Beirut', campaign: { name: 'Beirut 24/7', goal: 'coverage', startOffset: 2, days: 7, template: 'generic' } }, libraryId)
await site({ slug: 'draft-site', name: 'Draft site', status: 'draft', languages: ['en'], place: 'Cairo', campaign: { name: 'Cairo prayer', goal: 'people', startOffset: 10, days: 10, template: 'generic' } }, libraryId)
await db.destroy()
