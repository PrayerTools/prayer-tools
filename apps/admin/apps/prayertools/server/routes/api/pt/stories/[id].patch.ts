// Adds a story to (or removes it from) the landing page's stories section.
// Only stories whose writer allowed the site to publish them.
export default definePtHandler('pt.messages.write', async (event, tx) => {
  const id = getRouterParam(event, 'id')!
  const { published } = await ptBody<{ published?: boolean }>(event)
  const story = await tx.selectFrom('pt_story').select(['may_publish']).where('id', '=', id).executeTakeFirst()
  if (!story) ptNotFound('Story not found.')
  if (published && !story.may_publish) ptBadRequest('The writer did not allow this story to be published.')
  await tx.updateTable('pt_story').set({ published: !!published, published_at: published ? new Date() : null }).where('id', '=', id).execute()
  return { ok: true }
})
