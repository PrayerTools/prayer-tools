// Creates a campaign on the site. `relaunchOf` records the previous campaign
// as the one this relaunches (`relaunch_of`), starts from its answers and
// reuses its libraries (copies the site edited carry over; followed libraries
// pick up their latest published version), its kind,
// landing page, description, images, share messages, place and people group.
// Any other campaign takes its images, share messages, place and people group
// from the current main campaign, and a main campaign its landing page and
// description too, so the site's root page keeps its look.
export default definePtHandler('pt.campaigns.write', async (event, tx, ctx) => ptCreateCampaign(tx, ctx, await ptBody(event)))
