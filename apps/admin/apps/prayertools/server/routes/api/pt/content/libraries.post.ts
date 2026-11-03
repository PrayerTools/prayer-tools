// Adds content to a campaign: a library from the catalog (followed as-is),
// or new content written for the site from scratch.
export default definePtHandler('pt.content.write', async (event, tx, ctx) => ptAddCampaignContent(tx, ctx, await ptBody(event)))
