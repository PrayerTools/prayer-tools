// Adds a custom signup field (up to 5). The answers live on the CRM contact
// as a custom field `pt_<key>`, so they also show in the CRM.
export default definePtHandler('pt.site.write', async (event, tx, ctx) => ptCreateSignupField(tx, ctx, await ptBody(event)))
