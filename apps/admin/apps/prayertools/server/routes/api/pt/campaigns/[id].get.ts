export default definePtHandler('pt.site.read', async (event, tx) => ptCampaignDetail(tx, getRouterParam(event, 'id')!))
