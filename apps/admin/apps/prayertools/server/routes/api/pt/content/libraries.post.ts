// Adds content to a campaign: a library from the catalog (followed as-is),
// or new content written for the site from scratch.
export default definePtHandler('pt.content.write', async (event, tx, ctx) => {
  const b = await ptBody<{ campaignId?: string, libraryId?: string, title?: string, cadence?: string }>(event)
  const campaign = await tx.selectFrom('pt_campaign').select(['id', 'cadence', 'name']).where('id', '=', String(b.campaignId)).executeTakeFirst()
  if (!campaign) ptNotFound('Campaign not found.')
  let siteLibraryId: string
  if (b.libraryId) {
    const lib = await ptLibraryReadable(tx, b.libraryId, ctx.userId)
    const existing = await tx.selectFrom('pt_site_library').select('id').where('library_id', '=', lib.id).executeTakeFirst()
    siteLibraryId = existing?.id ?? (await tx.insertInto('pt_site_library').values({ library_id: lib.id, title: lib.title, cadence: lib.cadence }).returning('id').executeTakeFirstOrThrow()).id
  } else {
    const title = (String(b.title ?? '').trim() || `${campaign.name} library`).slice(0, 120)
    const cadence = b.cadence === 'weekly' ? 'weekly' : campaign.cadence
    siteLibraryId = (await tx.insertInto('pt_site_library').values({ library_id: null, title, cadence }).returning('id').executeTakeFirstOrThrow()).id
  }
  const max = await tx.selectFrom('pt_campaign_library').select(eb => eb.fn.max('position').as('max')).where('campaign_id', '=', campaign.id).executeTakeFirst()
  await tx.insertInto('pt_campaign_library').values({ campaign_id: campaign.id, site_library_id: siteLibraryId, position: Number(max?.max ?? -1) + 1 })
    .onConflict(oc => oc.columns(['campaign_id', 'site_library_id']).doNothing()).execute()
  return { siteLibraryId }
})
