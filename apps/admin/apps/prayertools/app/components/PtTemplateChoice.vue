<script setup lang="ts">
// "What would you like to create?": "Build your own" (the generic template)
// first, then the templates on offer today, and with `withPersonal` the
// champion's own templates and those shared with them.
import { offeredTemplates } from '@prayertools/shared/setup'
import { todayIn } from '@prayertools/shared/dates'
import type { PtPersonalTemplateOption } from '../composables/usePtCampaignDraft'

const props = defineProps<{ timezone?: string, withPersonal?: boolean }>()
const model = defineModel<string>({ required: true })
const personalId = defineModel<string | null>('personal', { default: null })
const emit = defineEmits<{ choose: [key: string], choosePersonal: [template: PtPersonalTemplateOption] }>()

const keys = computed(() => offeredTemplates(todayIn(props.timezone ?? 'UTC')))
const label = (key: string) => key === 'generic' ? 'Build your own' : PT_LABELS.template[key] ?? key

type PersonalOption = PtPersonalTemplateOption & { role: 'owner' | 'editor' | 'viewer', owner_name: string, libraries: number }
const { data: personal } = useFetch<{ templates: PersonalOption[] }>('/api/pt/campaign-templates', { key: 'pt-campaign-template-choice', immediate: !!props.withPersonal, server: false })
const personalTemplates = computed(() => props.withPersonal ? personal.value?.templates ?? [] : [])

function choose(key: string) {
  model.value = key
  personalId.value = null
  emit('choose', key)
}

function choosePersonal(t: PersonalOption) {
  personalId.value = t.id
  emit('choosePersonal', t)
}

const optionClass = (selected: boolean) => selected ? 'border-(--ui-primary) ring-1 ring-(--ui-primary) bg-(--ui-bg-elevated)' : 'border-(--ui-border) hover:bg-(--ui-bg-elevated)'
</script>

<template>
  <UFormField
    v-if="keys.length > 1 || personalTemplates.length"
    label="What would you like to create?"
    :ui="{ label: 'text-base font-semibold' }"
  >
    <div class="space-y-4">
      <div class="grid sm:grid-cols-2 gap-3">
        <button
          v-for="key in keys"
          :key="key"
          type="button"
          class="text-start rounded-lg border p-3 transition focus-visible:ring-2 focus-visible:ring-(--ui-primary)"
          :class="optionClass(!personalId && model === key)"
          :aria-pressed="!personalId && model === key"
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
      <div
        v-if="personalTemplates.length"
        class="space-y-2"
      >
        <p class="text-sm font-medium text-(--ui-text-muted)">
          Your templates <InfoTip text="Templates you saved from a campaign, and those shared with you. A campaign started from one takes its answers, landing page, end-of-campaign message, call to action and libraries." />
        </p>
        <div class="grid sm:grid-cols-2 gap-3">
          <button
            v-for="t in personalTemplates"
            :key="t.id"
            type="button"
            class="text-start rounded-lg border p-3 transition focus-visible:ring-2 focus-visible:ring-(--ui-primary)"
            :class="optionClass(personalId === t.id)"
            :aria-pressed="personalId === t.id"
            @click="choosePersonal(t)"
          >
            <span class="flex items-center gap-2">
              <UIcon
                name="i-lucide-bookmark"
                class="size-5 shrink-0 text-(--ui-primary)"
              />
              <span class="font-medium">{{ t.name }}</span>
            </span>
            <span class="block text-sm text-(--ui-text-muted) mt-1">
              {{ ptPlural(t.libraries, 'library', 'libraries') }}<template v-if="t.role !== 'owner'"> · from {{ t.owner_name }}</template>
            </span>
          </button>
        </div>
      </div>
    </div>
  </UFormField>
</template>
