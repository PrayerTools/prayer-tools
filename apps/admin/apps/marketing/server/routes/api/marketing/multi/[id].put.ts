export default defineMarketingUserHandler(async (event, tx, userId) => marketingUpdateParentDraft(tx, userId, getRouterParam(event, 'id'), await marketingBody(event)))
