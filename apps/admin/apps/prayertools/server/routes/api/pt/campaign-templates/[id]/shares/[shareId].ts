// Who a campaign template is shared with; only its owner shares it.
export default definePtShareHandler('pt_personal_template_shares', async (tx, id) => (await tx.selectFrom('pt_personal_template').select('name').where('id', '=', id).executeTakeFirst())?.name ?? null)
