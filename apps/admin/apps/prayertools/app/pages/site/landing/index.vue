<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

// `?campaign=<id>` edits that side campaign's own landing page.
const route = useRoute()
const campaignId = computed(() => typeof route.query.campaign === 'string' ? route.query.campaign : undefined)
const { data: campaigns } = useFetch<{ campaigns: { id: string, name: string }[] }>('/api/pt/campaigns', { key: 'pt-campaigns' })
const campaignName = computed(() => campaigns.value?.campaigns.find(c => c.id === campaignId.value)?.name)
</script>

<template>
  <div class="max-w-[96rem] mx-auto space-y-6">
    <PtCampaignTabs
      v-if="campaignId"
      :campaign-id="campaignId"
    />
    <PtLandingTabs v-else />
    <PtLandingEditor
      :key="campaignId ?? 'site'"
      :campaign-id="campaignId"
    >
      <template #heading>
        <h1 class="text-2xl font-semibold">
          {{ campaignId ? `${campaignName ?? 'Campaign'} landing page` : 'Landing page' }}
        </h1>
        <p class="mt-1 text-sm text-(--ui-text-muted)">
          {{ campaignId
            ? 'The first page people see at this side campaign\'s address. Your home page links to it while it is upcoming or running. Section headings and the signup form are shared with your site\'s landing page.'
            : 'The first page people see. Write the parts that are yours; the rest comes from your site\'s setup.' }}
        </p>
      </template>
    </PtLandingEditor>
  </div>
</template>
