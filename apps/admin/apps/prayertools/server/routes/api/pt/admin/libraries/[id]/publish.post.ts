// Publishes a platform library's drafts; sites following it get the new version.
export default defineEventHandler(async (event) => {
  await ptRequireLibraryOperator(event)
  const lib = await ptPlatformLibrary(getRouterParam(event, 'id')!)
  return { id: lib.id, version: await ptPublishLibrary(lib.id) }
})
