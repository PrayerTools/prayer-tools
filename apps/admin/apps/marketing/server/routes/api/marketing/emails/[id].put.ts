// Drafts only; a scheduled email goes back to draft to be edited.
export default defineMarketingHandler('marketing.send', async (event, tx, ctx) => marketingUpdateDraft(tx, ctx, getRouterParam(event, 'id'), await marketingBody(event)))
