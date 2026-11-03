export default defineMarketingHandler('marketing.send', async (event, tx, ctx) => marketingCreateDraft(tx, ctx, await marketingBody(event)))
