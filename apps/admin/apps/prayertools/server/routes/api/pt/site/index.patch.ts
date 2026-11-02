// Edits the site. Sending identity needs pt.site.manage (owners); everything
// else pt.site.write. Settings keep only values that differ from the code
// defaults.
export default definePtHandler('pt.site.write', async (event, tx, ctx) => ptUpdateSite(tx, ctx, await ptBody(event)))
