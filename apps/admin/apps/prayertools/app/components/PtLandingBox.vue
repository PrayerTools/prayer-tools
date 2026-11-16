<script setup lang="ts">
// One landing page section in the editor: heading, what it shows, arrows that
// move it up or down the page, a show switch (or "Always shown"), and its
// fields. Clicking or focusing it selects the section, which the preview mirrors.
const props = withDefaults(defineProps<{
  section: string
  title: string
  description?: string
  icon: string
  selected: boolean
  // null for sections that always show.
  shown: boolean | null
  canToggle: boolean
  // Which ways the section can move; absent for a section that stays in place.
  move?: { up: boolean, down: boolean }
  // Whether the fields show, for a section that collapses.
  open?: boolean
}>(), { open: undefined })
const emit = defineEmits<{ 'select': [], 'update:shown': [value: boolean], 'update:open': [value: boolean], 'move': [by: -1 | 1] }>()

const collapsible = computed(() => props.open !== undefined)

// Moving the row can drop keyboard focus, so it returns to the arrow used, or
// to the other one at the end of the list.
async function moveBy(by: -1 | 1) {
  emit('move', by)
  await nextTick()
  const row = document.getElementById(`pt-ed-${props.section}`)
  const arrow = (d: number) => row?.querySelector<HTMLButtonElement>(`[data-pt-move="${d}"]:not(:disabled)`)
  ;(arrow(by) ?? arrow(-by))?.focus()
}
</script>

<template>
  <UCard
    :id="`pt-ed-${section}`"
    class="scroll-mt-20 transition-[box-shadow,background-color]"
    :class="selected ? PT_LANDING_SELECTED : ''"
    @click="emit('select')"
    @focusin="emit('select')"
  >
    <template #header>
      <div class="flex items-start gap-3">
        <UButton
          v-if="collapsible"
          size="xs"
          variant="ghost"
          color="neutral"
          :icon="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          :aria-label="open ? 'Collapse' : 'Expand'"
          :aria-expanded="open"
          @click="emit('update:open', !open)"
        />
        <UIcon
          :name="icon"
          class="size-5 shrink-0 mt-0.5"
          :class="shown === false ? 'text-(--ui-text-dimmed)' : 'text-(--ui-primary)'"
        />
        <div class="min-w-0 flex-1">
          <p
            class="font-medium"
            :class="{ 'text-(--ui-text-muted)': shown === false }"
          >
            {{ title }}
          </p>
          <p
            v-if="description || $slots.description"
            class="text-sm text-(--ui-text-muted)"
          >
            <slot name="description">
              {{ description }}
            </slot>
          </p>
        </div>
        <slot name="actions" />
        <div
          v-if="move"
          class="flex shrink-0"
        >
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-lucide-arrow-up"
            aria-label="Move up"
            data-pt-move="-1"
            :disabled="!move.up"
            @click="moveBy(-1)"
          />
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-lucide-arrow-down"
            aria-label="Move down"
            data-pt-move="1"
            :disabled="!move.down"
            @click="moveBy(1)"
          />
        </div>
        <UBadge
          v-if="props.shown === null"
          variant="subtle"
          color="neutral"
          label="Always shown"
        />
        <USwitch
          v-else
          :model-value="props.shown"
          :disabled="!canToggle"
          label="Show"
          @update:model-value="v => emit('update:shown', v)"
        />
      </div>
    </template>
    <template
      v-if="$slots.default && (!collapsible || open)"
      #default
    >
      <div
        class="space-y-4"
        :class="{ 'opacity-60': shown === false }"
      >
        <slot />
      </div>
    </template>
  </UCard>
</template>
