<script setup lang="ts">
// "What would you like to create?": "Build your own" (the generic template)
// first, then the templates on offer today.
import { offeredTemplates } from '@prayertools/shared/setup'
import { todayIn } from '@prayertools/shared/dates'

const props = defineProps<{ timezone?: string }>()
const model = defineModel<string>({ required: true })
const emit = defineEmits<{ choose: [key: string] }>()

const keys = computed(() => offeredTemplates(todayIn(props.timezone ?? 'UTC')))
const label = (key: string) => key === 'generic' ? 'Build your own' : PT_LABELS.template[key] ?? key

function choose(key: string) {
  model.value = key
  emit('choose', key)
}
</script>

<template>
  <UFormField
    v-if="keys.length > 1"
    label="What would you like to create?"
    :ui="{ label: 'text-base font-semibold' }"
  >
    <div class="grid sm:grid-cols-2 gap-3">
      <button
        v-for="key in keys"
        :key="key"
        type="button"
        class="text-start rounded-lg border p-3 transition focus-visible:ring-2 focus-visible:ring-(--ui-primary)"
        :class="model === key ? 'border-(--ui-primary) ring-1 ring-(--ui-primary) bg-(--ui-bg-elevated)' : 'border-(--ui-border) hover:bg-(--ui-bg-elevated)'"
        :aria-pressed="model === key"
        @click="choose(key)"
      >
        <span class="flex items-center gap-2">
          <UIcon
            :name="PT_TEMPLATE_ICONS[key] ?? 'i-lucide-sparkles'"
            class="size-5 shrink-0 text-(--ui-primary)"
          />
          <span class="font-medium">{{ label(key) }}</span>
        </span>
        <span class="block text-sm text-(--ui-text-muted) mt-1">{{ PT_LABELS.templateDescription[key] }}</span>
      </button>
    </div>
  </UFormField>
</template>
