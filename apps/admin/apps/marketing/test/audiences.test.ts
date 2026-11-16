import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { withOrg } from '@prayertools/shared/db/scope'
import { jsonb } from '@prayertools/shared/db/json'
import { makeText } from '@prayertools/shared/translatable'
import { audienceCounts } from '../lib/audiences'
import { addPerson, captureHost, cleanup, closeEnv, createSite, testEnv, type TestEnv } from './helpers'

let env: TestEnv
beforeAll(() => {
  env = testEnv()
})
afterEach(async () => {
  await cleanup(env)
})
afterAll(async () => {
  await closeEnv(env)
})

async function endedCampaign(orgId: string): Promise<string> {
  return await withOrg(env.app, orgId, async (tx) => {
    const c = await tx.insertInto('pt_campaign').values({
      slug: 'c0',
      name: 'Advent 2025',
      start_mode: 'date',
      start_date: '2025-11-01',
      end_mode: 'date',
      end_date: '2025-12-01',
      goal: 'people',
      cadence: 'daily',
      timezone: 'UTC',
      cta: jsonb({}),
      published_at: new Date()
    }).returning('id').executeTakeFirstOrThrow()
    return c.id
  })
}

function counts(orgId: string, selected: string[] = []) {
  return withOrg(env.app, orgId, tx => audienceCounts(captureHost(), tx as never, orgId, selected))
}

describe('audiences', () => {
  it('lists each campaign newest first, then everyone who opted in, waiting lists and consent options', async () => {
    const site = await createSite(env)
    const past = await endedCampaign(site.orgId)
    const waiting = await addPerson(env, { orgId: site.orgId, campaignId: past })
    await withOrg(env.app, site.orgId, async (tx) => {
      await tx.insertInto('pt_notify_request').values({ contact_id: waiting.contactId, campaign_id: past, language: 'en', confirmed_at: new Date() }).execute()
      await tx.insertInto('pt_consent_option').values({ key: 'news', label: jsonb(makeText('en', 'Monthly news')) }).execute()
    })

    const { audiences } = await counts(site.orgId)
    expect(audiences.map(a => a.key)).toEqual([
      `campaign:${site.campaignId}`,
      `campaign:${past}`,
      'consented_updates',
      `waiting:${past}`,
      'custom:news'
    ])
    expect(audiences.map(a => a.label)).toEqual([
      `People in Lent ${site.slug}`,
      'People in Advent 2025',
      'Everyone who opted in to updates',
      'Waiting for Advent 2025 to run again',
      'Monthly news'
    ])
  })

  it('counts a person in several chosen audiences once', async () => {
    const site = await createSite(env)
    const past = await endedCampaign(site.orgId)
    await addPerson(env, site)
    await addPerson(env, site, { consent: false })
    await addPerson(env, { orgId: site.orgId, campaignId: past })
    await addPerson(env, site, { commitment: false })
    const keys = [`campaign:${site.campaignId}`, `campaign:${past}`, 'consented_updates']

    const { audiences, combined } = await counts(site.orgId, keys)
    expect(audiences.map(a => [a.key, a.count, a.notConsented])).toEqual([
      [keys[0], 1, 1],
      [keys[1], 1, 0],
      [keys[2], 3, 0]
    ])
    expect(combined).toBe(3)
  })
})
