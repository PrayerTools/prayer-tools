// Publishes a draft campaign: it appears on the public site and opens for
// signup. Waits for the checklist's required items.
export default definePtHandler('pt.campaigns.write', async (event, tx) => {
  const id = getRouterParam(event, 'id')!
  const row = await tx.selectFrom('pt_campaign').select(['id', 'published_at']).where('id', '=', id).executeTakeFirst()
  if (!row) ptNotFound('Campaign not found.')
  if (row.published_at) return { ok: true }
  const missing = (await ptLaunchChecklist(tx, id)).filter(i => i.required && !i.done)
  if (missing.length) ptBadRequest(`Finish these first: ${missing.map(i => i.label).join(', ')}.`)
  await tx.updateTable('pt_campaign').set({ published_at: new Date(), updated_at: new Date() }).where('id', '=', id).execute()
  return { ok: true }
})
