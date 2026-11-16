// What ending the campaign now would do, for the confirmation: how many people
// get the thank-you email, and whether the site sends it.
export default definePtHandler('pt.campaigns.write', async (event, tx) => ptEndPreview(tx, getRouterParam(event, 'id')!))
