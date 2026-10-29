<script setup lang="ts">
// Picks the time of a recurring 24/7 commitment: hours shaded by how covered
// they are from now to the campaign's end, then the slots inside the chosen
// hour, with the hours that most need someone listed first.
import { coverageByTimeOfDay, openOccurrences, type SlotCounts, type TimeOfDayCoverage } from '@prayertools/shared/coverage'
import { formatTime } from '~/utils/commitment'

const time = defineModel<string>({ required: true })
const props = defineProps<{ counts: SlotCounts, tz: string, weekdays: number[], duration: number, lang: string, idPrefix: string, compact?: boolean }>()
const { t } = useI18n()
const { num } = useSite()

const NEED_SHOWN = 3
const now = ref(Date.now())
const openHour = ref<number | null>(null)
const showAllNeeds = ref(false)
const showCoverage = ref(false)

const rows = computed(() => coverageByTimeOfDay(props.counts, props.tz, new Date(now.value), props.weekdays))

interface Hour {
  hour: number
  share: number
  available: boolean
  times: TimeOfDayCoverage[]
}

const hours = computed<Hour[]>(() => Array.from({ length: 24 }, (_, hour) => {
  const times = rows.value.filter(r => Math.floor(r.minute / 60) === hour)
  const total = times.reduce((n, r) => n + r.total, 0)
  const covered = times.reduce((n, r) => n + r.covered, 0)
  return { hour, share: total ? covered / total : 0, available: total > 0, times }
}))

const needs = computed(() => hours.value
  .filter(h => h.available && h.share < 1)
  .sort((a, b) => a.share - b.share || a.hour - b.hour))

const selectedMinute = computed(() => {
  const m = /^(\d{2}):(\d{2})$/.exec(time.value)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
})

watch(selectedMinute, (m) => {
  if (m !== null && openHour.value === null) openHour.value = Math.floor(m / 60)
}, { immediate: true })

const hourTimes = computed(() => openHour.value === null ? [] : hours.value[openHour.value]!.times)

function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

function share(r: { total: number, covered: number }): number {
  return r.total ? r.covered / r.total : 0
}

// The time in an hour that most needs someone.
function neediest(h: Hour): TimeOfDayCoverage | undefined {
  return h.times.filter(r => r.total > 0).sort((a, b) => share(a) - share(b) || a.minute - b.minute)[0]
}

function chooseHour(h: Hour) {
  openHour.value = h.hour
  if (h.times.length === 1) time.value = hhmm(h.times[0]!.minute)
}

function chooseNeed(h: Hour) {
  openHour.value = h.hour
  const best = neediest(h)
  if (best) time.value = hhmm(best.minute)
}

function inSelection(minute: number): boolean {
  const s = selectedMinute.value
  return s !== null && minute >= s && minute < s + props.duration
}

const hourFmt = computed(() => new Intl.DateTimeFormat(props.lang, { hour: 'numeric', timeZone: 'UTC' }))
function hourLabel(hour: number): string {
  return hourFmt.value.format(new Date(Date.UTC(2024, 0, 1, hour)))
}

function needLabel(h: Hour): string {
  return h.share === 0 ? t('picker.nobody') : h.share < 0.5 ? t('picker.mostly_open') : t('picker.some_gaps')
}

function shade(s: number): Record<string, string> {
  return { background: `color-mix(in oklab, var(--brand) ${Math.round(s * 55)}%, white)` }
}

const legend = computed(() => [
  { share: 0, label: t('picker.legend_none') },
  { share: 0.5, label: t('picker.legend_some') },
  { share: 1, label: t('picker.legend_full') }
])

const detail = computed(() => {
  const m = selectedMinute.value
  if (m === null) return null
  const { total, open } = openOccurrences(props.counts, props.tz, new Date(now.value), m, props.duration, props.weekdays)
  if (!total) return null
  const label = formatTime(hhmm(m), props.lang)
  return open ? t('picker.open_on', { time: label, open: num(open), total: num(total) }) : t('picker.all_covered', { time: label })
})

onMounted(() => { now.value = Date.now() })
</script>

<template>
  <div class="space-y-4">
    <div v-if="needs.length" class="space-y-2">
      <p :id="`${idPrefix}-needs`" class="text-sm font-medium">{{ t('picker.need_title') }}</p>
      <ul class="space-y-1" :aria-labelledby="`${idPrefix}-needs`">
        <li v-for="h in needs.slice(0, showAllNeeds ? 6 : NEED_SHOWN)" :key="h.hour">
          <button type="button" class="w-full flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-stone-200 bg-white px-3 py-3 text-start text-sm hover:border-stone-400 cursor-pointer" :aria-pressed="selectedMinute === neediest(h)?.minute" @click="chooseNeed(h)">
            <span class="font-medium tabular-nums">{{ compact ? formatTime(hhmm(neediest(h)?.minute ?? h.hour * 60), lang) : `${formatTime(hhmm(h.hour * 60), lang)} – ${formatTime(hhmm(((h.hour + 1) % 24) * 60), lang)}` }}</span>
            <span class="text-stone-600">{{ needLabel(h) }}</span>
          </button>
        </li>
      </ul>
      <UButton v-if="!compact && !showAllNeeds && needs.length > NEED_SHOWN" variant="link" color="neutral" size="sm" :label="t('picker.show_more')" @click="showAllNeeds = true" />
    </div>

    <button v-if="compact" type="button" class="text-sm font-medium underline underline-offset-4 cursor-pointer" :aria-expanded="showCoverage" :aria-controls="`${idPrefix}-coverage-grid`" @click="showCoverage = !showCoverage">{{ t(showCoverage ? 'picker.hide_coverage' : 'picker.view_coverage') }}</button>
    <div v-if="!compact || showCoverage" :id="`${idPrefix}-coverage-grid`" class="space-y-2">
      <p :id="`${idPrefix}-hours`" class="text-sm font-medium">{{ t('picker.title') }}</p>
      <div class="grid grid-cols-6 gap-1" role="group" :aria-labelledby="`${idPrefix}-hours`">
        <button
          v-for="h in hours"
          :key="h.hour"
          type="button"
          :disabled="!h.available"
          :aria-pressed="openHour === h.hour"
          :aria-label="t('picker.hour_label', { hour: hourLabel(h.hour), percent: num(Math.round(h.share * 100)) })"
          class="rounded border py-2 text-xs tabular-nums disabled:opacity-30"
          :class="openHour === h.hour ? 'border-(--brand) ring-2 ring-(--brand) font-semibold' : 'border-stone-200 hover:border-stone-400'"
          :style="shade(h.share)"
          @click="chooseHour(h)"
        >
          {{ hourLabel(h.hour) }}
        </button>
      </div>
      <ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600" aria-hidden="true">
        <li v-for="l in legend" :key="l.share" class="flex items-center gap-1.5">
          <span class="size-3 rounded-sm border border-stone-300" :style="shade(l.share)" />
          {{ l.label }}
        </li>
      </ul>
      <p class="text-xs text-stone-500">{{ t('coverage.times_in', { tz }) }}</p>
    </div>

    <div v-if="(!compact || showCoverage) && hourTimes.length > 1" class="grid grid-cols-4 gap-1" role="group" :aria-label="hourLabel(openHour!)">
      <button
        v-for="r in hourTimes"
        :key="r.minute"
        type="button"
        :disabled="!r.total"
        :aria-pressed="selectedMinute === r.minute"
        :aria-label="t('picker.time_label', { time: formatTime(hhmm(r.minute), lang), percent: num(Math.round(share(r) * 100)) })"
        class="rounded border py-2 text-sm tabular-nums disabled:opacity-30"
        :class="inSelection(r.minute) ? 'bg-(--brand) text-(--brand-text) border-(--brand)' : 'border-stone-200 hover:border-stone-400'"
        :style="inSelection(r.minute) ? undefined : shade(share(r))"
        @click="time = hhmm(r.minute)"
      >
        {{ formatTime(hhmm(r.minute), lang) }}
      </button>
    </div>

    <p v-if="detail" class="text-sm font-medium" aria-live="polite">{{ detail }}</p>
  </div>
</template>
