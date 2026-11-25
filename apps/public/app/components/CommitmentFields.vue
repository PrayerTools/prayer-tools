<script setup lang="ts">
// One prayer time: daily at a time, or chosen weekdays at a time, or in a
// monthly campaign a day of the month at a time, with a duration when the
// campaign's goal uses it. `timeless` leaves the time to a picker next to it.
import type { Cadence } from '@prayertools/shared/db/schema'
import { MONTH_DAYS } from '@prayertools/shared/schedule'
import type { CommitmentInput } from '~/utils/commitment'

const model = defineModel<CommitmentInput>({ required: true })
const props = defineProps<{ durationRule: 'required' | 'optional' | 'hidden', durations: number[], idPrefix: string, lang: string, timeless?: boolean, cadence?: Cadence }>()
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

// A monthly rule falls on a day of the month (`d15`) or the first of a weekday (`w1`).
const monthDayItems = computed(() => [
  ...MONTH_DAYS.map(d => ({ label: t(`commitment.month_day_${d}`), value: `d${d}` })),
  ...[0, 1, 2, 3, 4, 5, 6].map(d => ({ label: t(`commitment.first_weekday_${d}`), value: `w${d}` }))
])
const monthDay = computed({
  get: () => model.value.day_of_month ? `d${model.value.day_of_month}` : `w${model.value.days_of_week[0] ?? 0}`,
  set: (v: string) => {
    const n = Number(v.slice(1))
    if (v.startsWith('d')) Object.assign(model.value, { day_of_month: n, days_of_week: [] })
    else Object.assign(model.value, { day_of_month: null, days_of_week: [n] })
  }
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
  <!-- Two columns only when this box has room for them (28rem), wherever it sits on the page.
       The grid sizes its own columns: a container query here stops rendering in Chrome when another box is added beside it. -->
  <div class="grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(100%,max(13.5rem,50%_-_0.5rem)),1fr))]">
    <UFormField v-if="cadence === 'monthly'" :label="t('commitment.month_day')" :name="`${idPrefix}-month-day`" required>
      <USelect v-model="monthDay" :items="monthDayItems" class="w-full" />
    </UFormField>
    <UFormField v-else :label="t('commitment.how_often')" :name="`${idPrefix}-frequency`">
      <URadioGroup v-model="model.frequency" :items="frequencies" orientation="horizontal" :ui="{ fieldset: 'flex-wrap gap-y-2' }" />
    </UFormField>
    <UFormField v-if="!timeless" :label="t('commitment.time')" :name="`${idPrefix}-time`" required>
      <TimePicker :id="`${idPrefix}-time`" v-model="model.time" :lang="lang" required class="w-40" />
    </UFormField>
    <UFormField v-if="model.frequency === 'weekly'" :label="t('commitment.days')" :name="`${idPrefix}-days`" class="col-span-full" required>
      <UCheckboxGroup v-model="days" :items="weekdays" orientation="horizontal" :ui="{ fieldset: 'flex-wrap gap-y-2' }" />
    </UFormField>
    <UFormField v-if="durationRule !== 'hidden'" :label="t('commitment.duration')" :name="`${idPrefix}-duration`" :required="durationRule === 'required'">
      <USelect v-model="duration" :items="durationItems" :placeholder="t('commitment.duration_placeholder')" class="w-full max-w-48" />
    </UFormField>
  </div>
</template>
