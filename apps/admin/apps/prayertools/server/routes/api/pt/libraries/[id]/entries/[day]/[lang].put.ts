// Saves a draft entry. Drafts reach sites only when the library is published.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  await ptEditableLibrary(event, id)
  const { doc } = await ptBody<{ doc?: unknown }>(event)
  return await ptSaveLibraryDraft(id, Number(getRouterParam(event, 'day')), getRouterParam(event, 'lang')!, doc)
})
