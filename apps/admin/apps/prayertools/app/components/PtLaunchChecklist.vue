<script setup lang="ts">
// The site's launch checklist, with a link to fix each open item. `openOnly`
// lists just what is still to do and hides itself when nothing is. With
// `campaignId` it checks that campaign instead of the current one.
export interface PtChecklist {
  items: { key: string, label: string, done: boolean, required: boolean, important?: boolean, detail?: string, to: string }[]
  canPublish: boolean
}

const props = withDefaults(defineProps<{ openOnly?: boolean, title?: string, campaignId?: string }>(), { openOnly: false, title: 'Launch checklist', campaignId: undefined })

const { slug } = usePtSite()
const { data, refresh } = useFetch<PtChecklist>('/api/pt/site/checklist', {
  query: computed(() => ({ campaign: props.campaignId })),
  key: computed(() => `pt-checklist-${slug.value}-${props.campaignId ?? 'current'}`)
})
const items = computed(() => (data.value?.items ?? []).filter(i => !props.openOnly || !i.done))

defineExpose({ refresh, data })
</script>

<template>
  <UCard v-if="!openOnly || items.length">
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <h3 class="font-semibold">
          {{ title }}
        </h3>
        <UButton
          variant="ghost"
          color="neutral"
          size="xs"
          icon="i-lucide-refresh-cw"
          aria-label="Refresh checklist"
          @click="() => { refresh() }"
        />
      </div>
    </template>
    <ul class="space-y-2">
      <li
        v-for="item in items"
        :key="item.key"
        class="flex items-start gap-3"
      >
        <UIcon
          :name="item.done ? 'i-lucide-circle-check' : item.required || item.important ? 'i-lucide-circle-alert' : 'i-lucide-circle'"
          class="size-5 shrink-0 mt-0.5"
          :class="item.done ? 'text-(--ui-success)' : item.important ? 'text-(--ui-error)' : item.required ? 'text-(--ui-warning)' : 'text-(--ui-text-muted)'"
        />
        <div class="flex-1 min-w-0">
          <div class="text-sm">
            {{ item.label }}
            <span
              v-if="item.required && !item.done"
              class="text-xs text-(--ui-warning)"
            >(needed to publish)</span>
            <span
              v-else-if="item.important && !item.done"
              class="text-xs text-(--ui-error)"
            >(missing)</span>
          </div>
          <div
            v-if="item.detail"
            class="text-xs text-(--ui-text-muted)"
          >
            {{ item.detail }}
          </div>
        </div>
        <UButton
          v-if="!item.done"
          :to="item.to"
          size="xs"
          variant="link"
          :label="openOnly ? 'Open' : 'Fix'"
        />
      </li>
    </ul>
  </UCard>
</template>
