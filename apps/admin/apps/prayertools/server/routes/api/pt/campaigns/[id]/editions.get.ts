// The campaign's libraries that have a newer edition the caller may use, with
// those editions newest first: what a relaunch offers in place of each.
export default definePtHandler('pt.site.read', async (event, tx, ctx) => ({ libraries: await ptNewerEditions(tx, ctx.userId, getRouterParam(event, 'id')!) }))
