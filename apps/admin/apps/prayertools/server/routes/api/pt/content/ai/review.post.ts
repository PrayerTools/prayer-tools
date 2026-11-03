// Feedback on an entry with suggested edits and Scripture references.
export default definePtHandler('pt.content.write', async (event, tx, ctx) => {
  return await ptAiReview(tx, ctx, await ptBody(event))
})
