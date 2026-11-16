// Ends a running campaign now: reminders stop, the thank-you is queued and the
// public site shows the final results. An `end_message` and `cta` in the body are saved with it.
export default definePtHandler('pt.campaigns.write', async (event, tx, ctx) => ptEndCampaign(tx, ctx, getRouterParam(event, 'id')!, await ptBody(event)))
