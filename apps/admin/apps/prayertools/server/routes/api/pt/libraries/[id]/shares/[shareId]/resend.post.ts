// Who a library is shared with; only its owner shares it.
export default definePtShareHandler('pt_library_shares', async (tx, id) => (await tx.selectFrom('pt_library').select('title').where('id', '=', id).executeTakeFirst())?.title ?? null)
