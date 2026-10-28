<script setup lang="ts">
// The setup answers, each explained: what kind of campaign it is (short and
// focused, ongoing or start anytime, which sets how it starts and ends), its
// dates or (unless withLength is false) length, the goal and, unless
// withCadence is false, the cadence. A
// template pre-fills them; answers the template fixes are shown but locked,
// and `dated` (side campaigns) locks a start and an end date.
import { addDays, daysBetween } from '@prayertools/shared/dates'

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

// The answers while a campaign is being set up: the goal stays unset until chosen.
export type SetupDraft = Omit<SetupState, 'goal'> & { goal: SetupState['goal'] | null }

const props = withDefaults(defineProps<{ templateKey?: string, lockTemplate?: boolean, withCadence?: boolean, withLength?: boolean, dated?: boolean }>(), { templateKey: 'generic', lockTemplate: true, withCadence: true, withLength: true, dated: false })
const state = defineModel<SetupDraft>({ required: true })
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

type CampaignType = 'fixed' | 'ongoing' | 'anytime'
const typeItems = [
  { value: 'fixed', label: 'Short and focused', description: 'Everyone prays together for a set time, from a start date to an end date.' },
  { value: 'ongoing', label: 'Ongoing', description: 'Starts on a date and keeps going, with or without an end date.' },
  { value: 'anytime', label: 'Start anytime', description: 'No start date. Each person begins at day 1 when they sign up.' }
]
function typeOf(s: SetupDraft): CampaignType {
  if (s.start_mode === 'join') return 'anytime'
  if (s.end_mode === 'none') return 'ongoing'
  if (s.start_date && s.end_date && daysBetween(s.start_date, s.end_date) > (meta.value?.setup.fixedMaxDays ?? 50)) return 'ongoing'
  return 'fixed'
}
// Fixed and ongoing campaigns can both end on a date, so the chosen type is
// kept and only follows the answers when they no longer fit it.
const campaignType = ref<CampaignType>(typeOf(state.value))
watch(() => state.value, (s) => {
  campaignType.value = typeOf(s)
})
watch(() => [state.value.start_mode, state.value.end_mode], () => {
  const t = campaignType.value
  const fits = t === 'anytime' ? state.value.start_mode === 'join' : state.value.start_mode === 'date' && (t === 'ongoing' || state.value.end_mode === 'date')
  if (!fits) campaignType.value = typeOf(state.value)
})
function chooseType(t: CampaignType) {
  campaignType.value = t
  if (t === 'anytime') Object.assign(state.value, { start_mode: 'join', end_mode: 'days' })
  else Object.assign(state.value, { start_mode: 'date', end_mode: t === 'fixed' ? 'date' : 'none' })
}
// A short and focused campaign is set by its start date and either a number
// of days or an end date; each fills the other, and moving the start keeps the length.
const dayCount = ref<number | null>(null)
watch(() => state.value.start_date, (start, old) => {
  if (!start || campaignType.value !== 'fixed' || state.value.end_mode !== 'date') return
  const days = old && state.value.end_date ? daysBetween(old, state.value.end_date) + 1 : dayCount.value
  if (days && days > 0) state.value.end_date = addDays(start, days - 1)
})
watch(() => [state.value.start_date, state.value.end_date], ([start, end]) => {
  if (start && end) dayCount.value = daysBetween(start, end) + 1
}, { immediate: true })
function setDayCount(days: number | null) {
  dayCount.value = days
  if (days && state.value.start_date) state.value.end_date = addDays(state.value.start_date, days - 1)
}
const startToday = computed(() => ptFormatDate(new Date().toISOString().slice(0, 10)))
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
    <section
      v-if="!props.dated && open('start_mode')"
      class="space-y-4 py-6 first:pt-0 last:pb-0"
    >
      <UFormField
        label="What kind of campaign is it?"
        :ui="{ label: 'text-base font-semibold' }"
      >
        <URadioGroup
          :model-value="campaignType"
          :items="typeItems"
          variant="card"
          @update:model-value="(v) => chooseType(v as CampaignType)"
        />
      </UFormField>
    </section>
    <section class="space-y-4 py-6 first:pt-0 last:pb-0">
      <template v-if="state.start_mode === 'date'">
        <div class="flex flex-wrap gap-4">
          <UFormField
            label="Start date"
            :help="props.dated ? 'A side campaign has a start date and an end date.' : undefined"
            required
          >
            <UInput
              :model-value="state.start_date ?? undefined"
              type="date"
              :disabled="!open('start_date')"
              @update:model-value="(v) => { state.start_date = v ? String(v) : null }"
            />
          </UFormField>
          <UFormField
            v-if="state.end_mode === 'date' && campaignType === 'fixed'"
            label="How many days?"
          >
            <UInputNumber
              :model-value="dayCount"
              :min="1"
              :max="3650"
              :disabled="!open('end_date') && !!state.end_date && !open('start_date')"
              class="w-32"
              @update:model-value="(v) => setDayCount(v ?? null)"
            />
          </UFormField>
          <UFormField
            v-if="state.end_mode === 'date'"
            label="End date"
            :hint="campaignType === 'fixed' ? undefined : lengthLabel ?? undefined"
            required
          >
            <div class="flex items-center gap-2">
              <UInput
                :model-value="state.end_date ?? undefined"
                type="date"
                :disabled="!open('end_date') && !!state.end_date && !open('start_date')"
                @update:model-value="(v) => { state.end_date = v ? String(v) : null }"
              />
              <UButton
                v-if="campaignType === 'ongoing' && !props.dated"
                label="No end"
                color="neutral"
                variant="outline"
                @click="state.end_mode = 'none'"
              />
            </div>
          </UFormField>
          <UFormField
            v-else
            label="End date"
          >
            <div class="flex items-center gap-2 h-8">
              <span class="text-sm text-muted">No end</span>
              <UButton
                label="Add an end date"
                color="neutral"
                variant="outline"
                size="sm"
                @click="state.end_mode = 'date'"
              />
            </div>
          </UFormField>
        </div>
      </template>
      <template v-else>
        <UFormField label="Start">
          <p class="text-sm">
            Today, {{ startToday }}. Each person begins at {{ ptUnit(state.cadence) }} 1 when they sign up.
          </p>
        </UFormField>
        <UFormField
          v-if="withLength && state.end_mode === 'days'"
          :label="`How many ${ptUnit(state.cadence)}s does each person go through? (optional)`"
          help="Leave empty to go through all of the prayer content."
        >
          <UInputNumber
            :model-value="state.length_days"
            :min="1"
            :max="3650"
            placeholder="All"
            :disabled="!open('length_days')"
            @update:model-value="(v) => { state.length_days = v ?? null }"
          />
        </UFormField>
        <UFormField
          v-else-if="withLength"
          label="End"
        >
          <div class="flex items-center gap-2">
            <span class="text-sm text-muted">No end. People keep praying until they stop.</span>
            <UButton
              v-if="open('end_mode')"
              label="Set a length"
              color="neutral"
              variant="outline"
              size="sm"
              @click="state.end_mode = 'days'"
            />
          </div>
        </UFormField>
      </template>
    </section>
    <section class="space-y-4 py-6 first:pt-0 last:pb-0">
      <UFormField
        label="What is the goal?"
        :ui="{ label: 'text-base font-semibold' }"
      >
        <URadioGroup
          :model-value="state.goal ?? undefined"
          :items="goalItems"
          variant="card"
          :disabled="!open('goal')"
          @update:model-value="(v) => { state.goal = v as SetupState['goal'] }"
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
        v-if="state.goal && state.goal !== 'coverage'"
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
