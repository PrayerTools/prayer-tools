<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { id, campaigns, status } = usePtCampaign()
</script>

<template>
  <div class="max-w-[96rem] mx-auto space-y-6">
    <PtLandingTabs />
    <UEmpty
      v-if="status !== 'pending' && !campaigns.length"
      icon="i-lucide-calendar-plus"
      title="No campaign yet"
      description="Each campaign has its own landing page. Create a campaign first."
      :actions="[{ label: 'New campaign', icon: 'i-lucide-plus', to: '/site/campaigns/new' }]"
    />
    <PtLandingEditor
      v-else-if="id"
      :key="id"
      :campaign-id="id"
    >
      <template #heading>
        <div class="flex flex-wrap items-center gap-3">
          <h1 class="text-2xl font-semibold">
            Landing page
            <InfoTip text="The first page people see for this campaign. Write the parts that are yours; the rest comes from your site's setup. Section headings, color and logo are shared by all campaigns." />
          </h1>
          <PtCampaignSwitcher />
        </div>
      </template>
    </PtLandingEditor>
  </div>
</template>
