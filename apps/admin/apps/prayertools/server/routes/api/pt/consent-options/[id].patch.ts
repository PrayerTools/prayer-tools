// Edits a consent option's wording or turns it off. Past grants keep the
// wording that was shown at the time (copied into the consent log).
export default definePtHandler('pt.content.translate', async (event, tx, ctx) => ptUpdateConsentOption(tx, ctx, getRouterParam(event, 'id')!, await ptBody(event)))
