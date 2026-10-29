<script setup lang="ts">
import { campaignDateError } from '../utils/pt-setup-validation'
// The setup answers (start, end, goal and, unless withCadence is false,
// cadence). Only editable decisions and compatible choices are shown.
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

const props = withDefaults(defineProps<{ templateKey?: string, lockTemplate?: boolean, withCadence?: boolean }>(), { templateKey: 'generic', lockTemplate: true, withCadence: true })
const state = defineModel<SetupState>({ required: true })
const dateError = computed(() => campaignDateError(state.value))
const { data: meta } = usePtMeta()

const template = computed(() => meta.value?.templates.find(t => t.key === props.templateKey))
const open = (k: string) => !props.lockTemplate || !template.value || template.value.open.includes(k)

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
const goalItems = computed(() => (meta.value?.setup.goals ?? ['people', 'prayer_time', 'coverage']).filter(g => g !== 'coverage' || datedCampaign.value).map(g => ({
  value: g,
  label: g === 'people' ? `${PT_LABELS.goal[g]} (recommended)` : PT_LABELS.goal[g],
  description: PT_LABELS.goalDescription[g]
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

function openDatePicker(event: MouseEvent) {
  const target = event.currentTarget
  if (!(target instanceof HTMLInputElement) || target.disabled) return
  try { target.showPicker?.() } catch { /* Native keyboard entry remains available. */ }
}

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
const fixedTiming = computed(() => {
  if (open('start_mode') || open('end_mode')) return null
  if (state.value.start_mode === 'join') return 'Each person starts when they join and goes through the prayer content once.'
  const days = template.value?.setup.length_days
  return days ? `This template runs for ${days} days from your chosen start date. The end date is set automatically.` : null
})
</script>

<template>
  <div class="divide-y divide-(--ui-border-accented)">
    <p v-if="fixedTiming" class="pb-6 text-sm text-(--ui-text-muted)">{{ fixedTiming }}</p>
    <section v-if="open('start_mode') || (state.start_mode === 'date' && open('start_date'))" class="space-y-4 py-6 first:pt-0 last:pb-0">
      <UFormField
        v-if="open('start_mode')"
        label="When does it start?"
        :ui="{ label: 'text-base font-semibold' }"
        :help="!open('start_mode') ? 'Set by the template.' : undefined"
      >
        <URadioGroup
          v-model="state.start_mode"
          :items="startItems"
          variant="card"
          :disabled="!open('start_mode')"
        />
      </UFormField>
      <UFormField
        v-if="state.start_mode === 'date' && open('start_date')"
        label="Start date"
        required
      >
        <UInput
          :model-value="state.start_date ?? undefined"
          type="date"
          class="cursor-pointer"
          @click="openDatePicker"
          @update:model-value="(v) => { state.start_date = v ? String(v) : null }"
        />
      </UFormField>
    </section>
    <section v-if="open('end_mode') || (state.end_mode === 'date' && state.start_mode === 'date' && open('end_date')) || (state.end_mode === 'days' && open('length_days'))" class="space-y-4 py-6 first:pt-0 last:pb-0">
      <UFormField
        v-if="open('end_mode')"
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
        v-if="state.end_mode === 'date' && state.start_mode === 'date' && open('end_date')"
        label="End date"
        :error="dateError"
        :hint="lengthLabel ?? undefined"
        required
      >
        <UInput
          :model-value="state.end_date ?? undefined"
          :min="state.start_date ?? undefined"
          type="date"
          class="cursor-pointer"
          @click="openDatePicker"
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
        v-if="open('goal')"
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
        v-if="state.goal === 'people' && open('track_time')"
        label="Ask people how many minutes they plan to pray"
        description="Turn this on to add a prayer-duration question to the sign-up form, alongside their reminder time."
        :help="state.track_time ? 'On: people choose a duration, such as 15 minutes. You can total the time they commit to; this does not measure time actually spent praying.' : 'Off: people choose a reminder time only. Your campaign counts people, without asking for a duration.'"
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
      v-if="withCadence && open('cadence')"
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
