<script setup lang="ts">
// The setup answers (start, end, goal and, unless withCadence is false,
// cadence), each explained. A template pre-fills them; answers the template
// fixes are shown but locked, and `dated` (side campaigns) locks a start and
// an end date.
export interface SetupState {
  start_mode: 'date' | 'join'
  start_date: string | null
  end_mode: 'date' | 'none' | 'days'
  end_date: string | null
  length_days: number | null
  goal: 'people' | 'prayer_time' | 'coverage'
  cadence: 'daily' | 'weekly'
  track_time: boolean
  goal_target: number | null
  slot_min: number | null
}

const props = withDefaults(defineProps<{ templateKey?: string, lockTemplate?: boolean, withCadence?: boolean, dated?: boolean }>(), { templateKey: 'generic', lockTemplate: true, withCadence: true, dated: false })
const state = defineModel<SetupState>({ required: true })
const { data: meta } = usePtMeta()

const template = computed(() => meta.value?.templates.find(t => t.key === props.templateKey))
const open = (k: string) => {
  if (props.dated && (k === 'start_mode' || k === 'end_mode')) return false
  return !props.lockTemplate || !template.value || template.value.open.includes(k)
}
watch([() => props.dated, () => state.value.start_mode, () => state.value.end_mode], ([dated]) => {
  if (!dated) return
  if (state.value.start_mode !== 'date') state.value.start_mode = 'date'
  if (state.value.end_mode !== 'date') state.value.end_mode = 'date'
}, { immediate: true })

const startItems = [
  { value: 'date', label: PT_LABELS.startMode.date, description: 'Everyone prays on the same calendar, from the same first day.' },
  { value: 'join', label: PT_LABELS.startMode.join, description: 'Each person\'s day 1 is the day they sign up. Good for devotionals and crises.' }
]
const endItems = computed(() => state.value.start_mode === 'join'
  ? [
      { value: 'days', label: PT_LABELS.endMode.days, description: 'Each person goes through the prayer content once, from the first entry.' },
      { value: 'none', label: PT_LABELS.endMode.none, description: 'People keep praying until they stop.' }
    ]
  : [
      { value: 'date', label: PT_LABELS.endMode.date, description: 'The campaign ends for everyone on the same day.' },
      { value: 'none', label: PT_LABELS.endMode.none, description: 'An ongoing campaign with no end date.' }
    ])
// 24/7 coverage is a grid over the campaign's dates, so it needs both.
const datedCampaign = computed(() => state.value.start_mode === 'date' && state.value.end_mode === 'date')
const goalItems = computed(() => (meta.value?.setup.goals ?? ['people', 'prayer_time', 'coverage']).map(g => ({
  value: g,
  label: g === 'people' ? `${PT_LABELS.goal[g]} (recommended)` : PT_LABELS.goal[g],
  description: g === 'coverage' && !datedCampaign.value ? 'Needs a start date and an end date.' : PT_LABELS.goalDescription[g],
  disabled: g === 'coverage' && !datedCampaign.value
})))
const defaultSlot = computed(() => meta.value?.setup.defaultSlot ?? 15)
const slotItems = computed(() => (meta.value?.setup.slotOptions ?? [5, 10, 15, 30, 60]).map(m => ({
  value: m,
  label: m === defaultSlot.value ? `${m} minutes (default)` : `${m} minutes`
})))
const slot = computed({
  get: () => state.value.slot_min ?? defaultSlot.value,
  set: (v: number) => { state.value.slot_min = v === defaultSlot.value ? null : v }
})

watch(datedCampaign, (dated) => {
  if (!dated && state.value.goal === 'coverage') state.value.goal = 'prayer_time'
})

watch(() => state.value.start_mode, (m) => {
  if (m === 'join' && state.value.end_mode === 'date') state.value.end_mode = 'days'
  if (m === 'date' && state.value.end_mode === 'days') state.value.end_mode = 'date'
})

const lengthLabel = computed(() => {
  const s = state.value
  if (s.start_mode !== 'date' || s.end_mode !== 'date' || !s.start_date || !s.end_date) return null
  const days = Math.round((Date.parse(s.end_date) - Date.parse(s.start_date)) / 86_400_000) + 1
  if (days < 1) return null
  const fixed = days - 1 <= (meta.value?.setup.fixedMaxDays ?? 50)
  return `${days} days · shows as ${fixed ? 'a fixed' : 'an ongoing'} campaign`
})
</script>

<template>
  <div class="divide-y divide-(--ui-border-accented)">
    <section class="space-y-4 py-6 first:pt-0 last:pb-0">
      <UFormField
        label="When does it start?"
        :ui="{ label: 'text-base font-semibold' }"
        :help="props.dated ? 'A side campaign has a start date and an end date.' : !open('start_mode') ? 'Set by the template.' : undefined"
      >
        <URadioGroup
          v-model="state.start_mode"
          :items="startItems"
          variant="card"
          :disabled="!open('start_mode')"
        />
      </UFormField>
      <UFormField
        v-if="state.start_mode === 'date'"
        label="Start date"
        required
      >
        <UInput
          :model-value="state.start_date ?? undefined"
          type="date"
          @update:model-value="(v) => { state.start_date = v ? String(v) : null }"
        />
      </UFormField>
    </section>
    <section class="space-y-4 py-6 first:pt-0 last:pb-0">
      <UFormField
        label="When does it end?"
        :ui="{ label: 'text-base font-semibold' }"
      >
        <URadioGroup
          v-model="state.end_mode"
          :items="endItems"
          variant="card"
          :disabled="!open('end_mode')"
        />
      </UFormField>
      <UFormField
        v-if="state.end_mode === 'date' && state.start_mode === 'date'"
        label="End date"
        :hint="lengthLabel ?? undefined"
        required
      >
        <UInput
          :model-value="state.end_date ?? undefined"
          type="date"
          @update:model-value="(v) => { state.end_date = v ? String(v) : null }"
          :disabled="!open('end_date') && !!state.end_date && !open('start_date')"
        />
      </UFormField>
      <UFormField
        v-if="state.end_mode === 'days' && open('length_days')"
        :label="`How many ${ptUnit(state.cadence)}s does each person go through? (optional)`"
        help="Leave empty to go through all of the prayer content."
      >
        <UInputNumber
          :model-value="state.length_days"
          :min="1"
          :max="3650"
          placeholder="All"
          @update:model-value="(v) => { state.length_days = v ?? null }"
        />
      </UFormField>
    </section>
    <section class="space-y-4 py-6 first:pt-0 last:pb-0">
      <UFormField
        label="What is the goal?"
        :ui="{ label: 'text-base font-semibold' }"
      >
        <URadioGroup
          v-model="state.goal"
          :items="goalItems"
          variant="card"
          :disabled="!open('goal')"
        />
      </UFormField>
      <UFormField
        v-if="state.goal === 'people'"
        label="Track time committed"
        help="Ask people how long they will pray (15 minutes by default)."
      >
        <USwitch
          v-model="state.track_time"
          :disabled="!open('track_time')"
        />
      </UFormField>
      <UFormField
        v-if="state.goal === 'coverage'"
        label="Length of one prayer slot"
        help="People sign up for whole slots, and the calendar shows how many people pray in each one."
      >
        <USelect
          v-model="slot"
          :items="slotItems"
          class="w-48"
        />
      </UFormField>
      <UFormField
        v-if="state.goal !== 'coverage'"
        :label="state.goal === 'people' ? 'How many people are you hoping for? (optional)' : 'Minutes of prayer per day to aim for'"
        :help="state.goal === 'prayer_time' ? '1440 minutes is 24 hours of prayer every day.' : undefined"
      >
        <UInputNumber
          v-model="state.goal_target"
          :min="1"
          :placeholder="state.goal === 'prayer_time' ? '1440' : ''"
        />
      </UFormField>
    </section>
    <section
      v-if="withCadence"
      class="space-y-4 py-6 first:pt-0 last:pb-0"
    >
      <UFormField
        label="How often is there new prayer content?"
        :ui="{ label: 'text-base font-semibold' }"
      >
        <URadioGroup
          v-model="state.cadence"
          :items="PT_CADENCE_ITEMS"
          orientation="horizontal"
          variant="card"
          :disabled="!open('cadence')"
        />
      </UFormField>
    </section>
  </div>
</template>
