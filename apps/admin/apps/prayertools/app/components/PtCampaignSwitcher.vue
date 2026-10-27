<script setup lang="ts">
// Which campaign the page edits, shared by every campaign page. A site with
// one campaign shows its name; ended campaigns are listed last.
const { id, campaign, campaigns, select } = usePtCampaign()

const items = computed(() => {
  const item = (c: { id: string, name: string }) => ({ label: c.name, value: c.id })
  const open = campaigns.value.filter(c => c.status !== 'ended').map(item)
  const ended = campaigns.value.filter(c => c.status === 'ended').map(item)
  return [
    ...(open.length ? [open] : []),
    ...(ended.length ? [[{ type: 'label' as const, label: 'Ended' }, ...ended]] : [])
  ]
})
const model = computed({
  get: () => id.value,
  set: (v: string | undefined) => { if (v) select(v) }
})
</script>

<template>
  <div
    v-if="campaign"
    class="flex items-center gap-2"
  >
    <USelect
      v-if="campaigns.length > 1"
      v-model="model"
      :items="items"
      icon="i-lucide-calendar-range"
      class="w-64"
      aria-label="Campaign"
    />
    <span
      v-else
      class="inline-flex items-center gap-1.5 text-sm font-medium"
    >
      <UIcon
        name="i-lucide-calendar-range"
        class="size-4 text-(--ui-text-muted)"
      />
      {{ campaign.name }}
    </span>
    <UBadge
      :label="PT_LABELS.campaignStatus[campaign.status]"
      :color="ptStatusColor(campaign.status)"
      variant="subtle"
    />
  </div>
</template>
