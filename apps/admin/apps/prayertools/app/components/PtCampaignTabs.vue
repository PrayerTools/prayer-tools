<script setup lang="ts">
// A campaign's pages: its overview, a side campaign's landing page, and the
// content, emails and stats pages opened for that campaign.
const props = defineProps<{ campaignId: string }>()
const { can } = usePtSite()
const { data: campaigns } = useFetch<{ campaigns: { id: string, kind: 'side' | null }[] }>('/api/pt/campaigns', { key: 'pt-campaigns' })
const side = computed(() => campaigns.value?.campaigns.find(c => c.id === props.campaignId)?.kind === 'side')
const items = computed(() => {
  const query = { campaign: props.campaignId }
  return [
    { label: 'Overview', to: `/site/campaigns/${props.campaignId}`, icon: 'i-lucide-calendar-range' },
    ...(side.value ? [{ label: 'Landing page', to: '/site/landing', query, icon: 'i-lucide-panels-top-left' }] : []),
    { label: 'Content', to: '/site/content', query, icon: 'i-lucide-book-open' },
    ...(can('pt.email.send') ? [{ label: 'Emails', to: '/marketing/test-emails', query, icon: 'i-lucide-mail-check' }] : []),
    { label: 'Stats', to: '/site/stats', query, icon: 'i-lucide-chart-line' }
  ]
})
</script>

<template>
  <PtSectionTabs :items="items" />
</template>
