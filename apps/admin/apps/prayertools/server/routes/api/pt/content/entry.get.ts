// One entry (day × language) of a site library, from the library while the
// site follows it, from the site's copy otherwise.
export default definePtHandler('pt.site.read', async (event, tx) => {
  const q = getQuery(event)
  return await ptSiteEntry(tx, String(q.siteLibrary ?? ''), Number(q.day), String(q.lang ?? ''))
})
