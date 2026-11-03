// A new preview link for a draft site. Only the hash is stored; creating a
// link invalidates the previous one.
export default definePtHandler('pt.site.read', async (_event, tx, ctx) => ({ url: await ptNewPreviewLink(tx, ctx) }))
