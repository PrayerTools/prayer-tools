// The sites following a platform library and the campaigns using it there,
// plus how many sites keep their own edited copy.
export default defineEventHandler(async (event) => {
  await ptRequireLibraryOperator(event)
  const lib = await ptPlatformLibrary(getRouterParam(event, 'id')!)
  const followers = await ptLibraryFollowers(lib.id)
  const { copies } = await ptLibraryUsage(lib.id)
  return {
    library: { id: lib.id, key: lib.key, title: lib.title },
    following: followers.map(f => ({ site: f.site, campaigns: f.campaigns })),
    copies
  }
})
