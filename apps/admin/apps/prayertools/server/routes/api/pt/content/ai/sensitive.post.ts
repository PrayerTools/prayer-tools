// Risky details in an entry, with suggested replacements.
export default definePtHandler('pt.content.write', async (event, tx, ctx) => {
  return await ptAiSensitive(tx, ctx, await ptBody(event))
})
