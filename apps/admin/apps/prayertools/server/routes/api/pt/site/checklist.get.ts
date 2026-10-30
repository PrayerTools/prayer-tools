// The launch checklist for the site and its current campaign, or for `?campaign=<id>`.
export default definePtHandler('pt.site.read', async (event, tx) => {
  const campaign = getQuery(event).campaign
  const items = await ptLaunchChecklist(tx, typeof campaign === 'string' ? campaign : undefined)
  return { items, canPublish: items.every(i => !i.required || i.done) }
})
