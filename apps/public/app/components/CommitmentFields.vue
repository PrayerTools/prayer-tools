<script setup lang="ts">
// One prayer time: daily at a time, or chosen weekdays at a time, with a
// duration when the campaign's goal uses it. `timeless` leaves the time to a
// picker next to it.
import type { CommitmentInput } from '~/utils/commitment'

const model = defineModel<CommitmentInput>({ required: true })
const props = defineProps<{ durationRule: 'required' | 'optional' | 'hidden', durations: number[], idPrefix: string, lang: string, timeless?: boolean, compact?: boolean }>()
const { t } = useI18n()

const frequencies = computed(() => [
  { label: t('commitment.daily'), value: 'daily' },
  { label: t('commitment.weekly'), value: 'weekly' }
])

const weekdays = computed(() => {
  const fmt = new Intl.DateTimeFormat(props.lang, { weekday: 'short', timeZone: 'UTC' })
  // 2024-01-07 is a Sunday.
  return [0, 1, 2, 3, 4, 5, 6].map(d => ({ label: fmt.format(new Date(Date.UTC(2024, 0, 7 + d))), value: String(d) }))
})

const days = computed({
  get: () => model.value.days_of_week.map(String),
  set: (v: string[]) => { model.value.days_of_week = v.map(Number).sort() }
})

const duration = computed({
  get: () => model.value.duration_min ?? undefined,
  set: (v: number | undefined) => { model.value.duration_min = v ?? null }
})

const durationItems = computed(() => props.durations.map(d => ({ label: formatMinutes(d, props.lang), value: d })))
</script>

<template>
  <div class="grid gap-4 sm:grid-cols-2">
    <UFormField :label="t('commitment.how_often')" :name="`${idPrefix}-frequency`">
      <URadioGroup v-if="!compact" v-model="model.frequency" :items="frequencies" orientation="horizontal" />
      <div v-else class="space-y-1">
        <p class="text-sm">{{ t(model.frequency === 'daily' ? 'commitment.daily' : 'commitment.weekly') }}</p>
        <button type="button" class="text-sm text-(--ui-primary) underline underline-offset-4" :aria-expanded="model.frequency === 'weekly'" @click="model.frequency = model.frequency === 'daily' ? 'weekly' : 'daily'">{{ t(model.frequency === 'daily' ? 'signup.choose_days' : 'commitment.daily') }}</button>
      </div>
    </UFormField>
    <UFormField v-if="!timeless" :label="t('commitment.time')" :name="`${idPrefix}-time`" :help="t('commitment.time_help')" required>
      <UInput :id="`${idPrefix}-time`" v-model="model.time" type="time" required class="w-40" />
    </UFormField>
    <UFormField v-if="model.frequency === 'weekly'" :label="t('commitment.days')" :name="`${idPrefix}-days`" class="sm:col-span-2" required>
      <UCheckboxGroup v-model="days" :items="weekdays" orientation="horizontal" class="flex-wrap" />
    </UFormField>
    <UFormField v-if="durationRule !== 'hidden'" :label="t('commitment.duration')" :name="`${idPrefix}-duration`" :required="durationRule === 'required'">
      <USelect v-model="duration" :items="durationItems" :placeholder="t('commitment.duration_placeholder')" class="w-48" />
    </UFormField>
  </div>
</template>
