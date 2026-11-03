// A site's own consent option (e.g. "Send me news about our church's
// mission trips"), offered unchecked at signup. Stored in the CRM consent
// state as purpose `custom:<key>`.
export default definePtHandler('pt.site.write', async (event, tx) => ptCreateConsentOption(tx, await ptBody(event)))
