// Edits a campaign's template, setup answers, name, address, goal target, end
// message and call to action, and its landing page, short description, images
// and share messages. Existing commitments keep their windows.
export default definePtHandler(null, async (event, tx, ctx) => ptUpdateCampaign(tx, ctx, getRouterParam(event, 'id')!, await ptBody(event)))
