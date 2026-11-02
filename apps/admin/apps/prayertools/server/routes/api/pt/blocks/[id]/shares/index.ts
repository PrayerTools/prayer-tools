// Who a block is shared with; only its owner shares it.
export default definePtShareHandler('pt_personal_block_shares', async (tx, id) => (await tx.selectFrom('pt_personal_block').select('name').where('id', '=', id).executeTakeFirst())?.name ?? null)
