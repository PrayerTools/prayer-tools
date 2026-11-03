// Drafts for consecutive entries from pasted field reports, for review.
export default definePtHandler('pt.content.write', async (event, tx, ctx) => {
  return await ptAiSeries(tx, ctx, await ptBody(event))
})
