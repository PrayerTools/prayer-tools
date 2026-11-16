// Deletes a platform library. Refuses while sites follow it, listing them,
// unless `?detach=1`, which first gives each following site a frozen copy of
// the published entries so their prayer content stays.
export default defineEventHandler(async (event) => {
  await ptRequireLibraryOperator(event)
  const lib = await ptPlatformLibrary(getRouterParam(event, 'id')!)
  const followers = await ptLibraryFollowers(lib.id)
  if (followers.length && getQuery(event).detach !== '1') {
    throw createError({
      statusCode: 409,
      statusMessage: `${followers.length} ${followers.length === 1 ? 'site follows' : 'sites follow'} this library; their prayer content would disappear.`,
      data: { following: followers.map(f => ({ site: f.site, campaigns: f.campaigns })) }
    })
  }
  await ptDetachFollowers(followers)
  await ptAdminDb().deleteFrom('pt_library').where('id', '=', lib.id).execute()
  return { id: lib.id, detached: followers.length }
})
