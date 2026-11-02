<script setup lang="ts">
// Drafts of a series written by AI, waiting for review. Each one opens in
// the editor for its day or week; none is saved from here.
import type { TiptapDoc } from '@prayertools/shared/db/schema'

const props = defineProps<{
  drafts: { day: number, doc: TiptapDoc }[]
  unresolved: string[]
  unit: string
  written: (day: number) => boolean
}>()
const emit = defineEmits<{
  use: [draft: { day: number, doc: TiptapDoc }]
  discard: [day: number]
}>()
const open = defineModel<boolean>('open', { default: false })
const Unit = computed(() => props.unit.charAt(0).toUpperCase() + props.unit.slice(1))
</script>

<template>
  <USlideover
    v-model:open="open"
    title="Drafts to review"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div class="space-y-4">
        <UAlert
          v-if="unresolved.length"
          color="warning"
          variant="subtle"
          icon="i-lucide-book-x"
          :title="`Couldn't look up ${unresolved.join(', ')}`"
          description="Add the verse text in those Scripture blocks before saving."
        />
        <p
          v-if="!drafts.length"
          class="text-sm text-(--ui-text-muted)"
        >
          No drafts left.
        </p>
        <UCard
          v-for="d in drafts"
          :key="d.day"
        >
          <template #header>
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="font-semibold">
                {{ Unit }} {{ d.day }}
              </h3>
              <UBadge
                v-if="written(d.day)"
                size="sm"
                color="warning"
                variant="subtle"
                label="Already written: the draft replaces it when you save"
              />
              <div class="ms-auto flex gap-2">
                <UButton
                  size="sm"
                  color="neutral"
                  variant="ghost"
                  label="Discard"
                  @click="emit('discard', d.day)"
                />
                <UButton
                  size="sm"
                  icon="i-lucide-pencil"
                  label="Review and edit"
                  @click="emit('use', d)"
                />
              </div>
            </div>
          </template>
          <PtContentView :doc="d.doc" />
        </UCard>
      </div>
    </template>
  </USlideover>
</template>
