// Edits a signup question's labels (any language), options, required flag
// and position. The kind and key stay fixed once people have answered.
export default definePtHandler('pt.content.translate', async (event, tx, ctx) => ptUpdateSignupField(tx, ctx, getRouterParam(event, 'id')!, await ptBody(event)))
