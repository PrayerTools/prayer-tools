// Saves an entry. Editors edit any language; translators every language but
// the site's default. The first edit of a followed library freezes the
// site's copy. Editing the default language flags that day's other
// languages as out of date instead of overwriting them.
export default definePtHandler(null, async (event, tx, ctx) => ptSaveSiteEntry(tx, ctx, await ptBody(event)))
