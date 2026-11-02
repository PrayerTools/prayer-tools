// A draft entry from pasted field reports, for review in the editor.
export default definePtHandler('pt.content.write', async (event, tx, ctx) => {
  return await ptAiDraft(tx, ctx, await ptBody(event))
})
