// Who an email template is shared with; only its owner shares it.
export default definePtShareHandler('marketing_template_shares', async (tx, id) => (await tx.selectFrom('marketing_template').select('name').where('id', '=', id).executeTakeFirst())?.name ?? null)
