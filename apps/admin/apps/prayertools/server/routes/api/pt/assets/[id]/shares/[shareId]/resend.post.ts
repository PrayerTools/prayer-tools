// Who an image is shared with; only its owner shares it.
export default definePtShareHandler('pt_personal_asset_shares', async (tx, id) => {
  const alt = (await tx.selectFrom('pt_personal_asset').select('alt').where('id', '=', id).executeTakeFirst())?.alt
  return alt?.values[alt.source] || 'an image'
})
