export default defineMarketingUserHandler(async (event, tx, userId) => marketingCreateParentDraft(tx, userId, await marketingBody(event)))
