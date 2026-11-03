export default definePtHandler('pt.intercessors.read', async (_event, tx) => {
  const stories = await tx.selectFrom('pt_story')
    .leftJoin('pt_campaign', 'pt_campaign.id', 'pt_story.campaign_id')
    .selectAll('pt_story')
    .select('pt_campaign.name as campaign_name')
    .orderBy('pt_story.created_at', 'desc')
    .limit(500)
    .execute()
  return { stories }
})
