// A champion's own campaign templates (`pt_personal_template`): what "Save as
// template" keeps from a campaign, and how a new campaign on any of their
// sites starts from one.
import { sql } from 'kysely'
import type { Tx } from './db/scope'
import type { CampaignBranding, CampaignCta, CampaignLanding, PersonalTemplateSetup, TranslatableText } from './db/schema'
import { jsonb, pgArray } from './db/json'
import { daysBetween } from './dates'

export interface PersonalTemplateContent {
  template_key: string | null
  setup: PersonalTemplateSetup
  landing: CampaignLanding
  branding: CampaignBranding
  description: TranslatableText | null
  end_message: TranslatableText | null
  cta: CampaignCta
  library_ids: string[]
}

export interface PersonalTemplate extends PersonalTemplateContent {
  id: string
  owner_user_id: string
  name: string
}

// Read inside the campaign's site: its setup answers without dates (a dated
// campaign keeps its length in days), landing page, hero image, end message,
// call to action, and the libraries its content comes from. Content written
// for the site stays on the site.
export async function templateFromCampaign(tx: Tx, campaignId: string): Promise<PersonalTemplateContent | null> {
  const c = await tx.selectFrom('pt_campaign').selectAll().where('id', '=', campaignId).executeTakeFirst()
  if (!c) return null
  const libs = await tx.selectFrom('pt_campaign_library as cl')
    .innerJoin('pt_site_library as sl', 'sl.id', 'cl.site_library_id')
    .select('sl.library_id')
    .where('cl.campaign_id', '=', campaignId).where('sl.library_id', 'is not', null)
    .orderBy('cl.position').execute()
  const dated = c.start_mode === 'date' && c.end_mode === 'date' && c.start_date && c.end_date
  return {
    template_key: c.template_key,
    setup: {
      start_mode: c.start_mode,
      end_mode: c.end_mode,
      length_days: dated ? daysBetween(c.start_date!, c.end_date!) + 1 : c.length_days,
      goal: c.goal,
      cadence: c.cadence,
      track_time: c.track_time,
      goal_target: c.goal_target,
      slot_min: c.slot_min
    },
    landing: c.landing,
    branding: c.branding,
    description: c.description,
    end_message: c.end_message,
    cta: c.cta,
    library_ids: [...new Set(libs.map(l => l.library_id!))]
  }
}

function templateValues(content: PersonalTemplateContent) {
  return {
    template_key: content.template_key,
    setup: jsonb(content.setup),
    landing: jsonb(content.landing),
    branding: jsonb(content.branding),
    description: content.description ? jsonb(content.description) : null,
    end_message: content.end_message ? jsonb(content.end_message) : null,
    cta: jsonb(content.cta),
    library_ids: pgArray(content.library_ids, 'uuid')
  }
}

// In the owner's personal-app transaction (`app.current_user`).
export async function savePersonalTemplate(tx: Tx, ownerUserId: string, name: string, content: PersonalTemplateContent): Promise<string> {
  const row = await tx.insertInto('pt_personal_template')
    .values({ owner_user_id: ownerUserId, name, ...templateValues(content) } as never)
    .returning('id').executeTakeFirstOrThrow()
  return row.id
}

// Replaces a template's content with a campaign's; its owner or an editor.
// False when the caller can't change it.
export async function replacePersonalTemplate(tx: Tx, id: string, content: PersonalTemplateContent): Promise<boolean> {
  const res = await tx.updateTable('pt_personal_template')
    .set({ ...templateValues(content), updated_at: new Date() } as never)
    .where('id', '=', id).executeTakeFirst()
  return Number(res.numUpdatedRows) > 0
}

// A template the caller owns or that is shared with them, in their
// personal-app transaction.
export async function readPersonalTemplate(tx: Tx, id: string): Promise<PersonalTemplate | null> {
  const row = await tx.selectFrom('pt_personal_template')
    .select(['id', 'owner_user_id', 'name', 'template_key', 'setup', 'landing', 'branding', 'description', 'end_message', 'cta', 'library_ids'])
    .where('id', '=', id).executeTakeFirst()
  return row ?? null
}

// Adds a template's libraries to a new campaign, in order, inside the
// campaign's site. A library the user can no longer read (unshared, deleted)
// is left out. The site's own copy of a library it already uses carries over,
// edits included.
export async function addTemplateLibraries(tx: Tx, campaignId: string, libraryIds: string[], userId: string): Promise<string[]> {
  const added: string[] = []
  for (const id of libraryIds) {
    const lib = await tx.selectFrom('pt_library').select(['id', 'title', 'cadence', 'owner_user_id', 'visibility']).where('id', '=', id).executeTakeFirst()
    if (!lib) continue
    if (lib.visibility !== 'published' && lib.owner_user_id !== userId) {
      const { rows } = await sql<{ shared: boolean }>`select pt_library_shares_has_member(${id}::uuid, ${userId}::uuid) as shared`.execute(tx)
      if (!rows[0]?.shared) continue
    }
    const existing = await tx.selectFrom('pt_site_library').select('id').where('library_id', '=', id).executeTakeFirst()
    const siteLibraryId = existing?.id ?? (await tx.insertInto('pt_site_library').values({ library_id: id, title: lib.title, cadence: lib.cadence } as never).returning('id').executeTakeFirstOrThrow()).id
    await tx.insertInto('pt_campaign_library').values({ campaign_id: campaignId, site_library_id: siteLibraryId, position: added.length } as never)
      .onConflict(oc => oc.columns(['campaign_id', 'site_library_id']).doNothing()).execute()
    added.push(id)
  }
  return added
}
