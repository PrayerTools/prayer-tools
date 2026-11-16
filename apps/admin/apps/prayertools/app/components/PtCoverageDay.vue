<script setup lang="ts">
// One day of a 24/7 campaign: every slot with how many people have committed
// to it, grouped by clock hour. Counts only.
import { slotsByClockHour, slotsInRange } from '@prayertools/shared/coverage'

const props = defineProps<{
  day: { date: string, percent: number, from: number, to: number }
  grid: { start: string, slotMinutes: number, timezone: string, slots: number[] }
}>()

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || props.grid.timezone
  } catch {
    return props.grid.timezone
  }
}
const localTz = browserTimezone()
const useLocal = ref(false)
const tz = computed(() => useLocal.value ? localTz : props.grid.timezone)

const slots = computed(() => slotsInRange(props.grid, props.day.from, props.day.to))

const hours = computed(() => {
  const zone = { timeZone: tz.value }
  const hourFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', ...zone })
  const zonedHourFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZoneName: 'short', ...zone })
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', ...zone })
  const dateFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', ...zone })
  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric', ...zone })
  const groups = slotsByClockHour(slots.value, tz.value)
  const labels = groups.map(g => hourFmt.format(g[0]!.at))
  let date = props.day.date
  return groups.map((g, i) => {
    const first = g[0]!.at
    // An hour the clocks repeat is told apart by its zone abbreviation.
    const repeated = labels[i] === labels[i - 1] || labels[i] === labels[i + 1]
    // Shown in another zone, the day's slots can fall on two calendar dates there.
    const localDate = dateFmt.format(first)
    const dateLabel = localDate !== date ? dayFmt.format(first) : null
    date = localDate
    return {
      key: g[0]!.index,
      label: repeated ? zonedHourFmt.format(first) : labels[i]!,
      repeated,
      dateLabel,
      slots: g.map(s => ({
        ...s,
        minute: `:${timeFmt.formatToParts(s.at).find(p => p.type === 'minute')?.value ?? ''}`,
        time: timeFmt.format(s.at)
      }))
    }
  })
})

const n = (count: number) => count.toLocaleString()
const slotWord = (count: number) => count === 1 ? 'slot' : 'slots'

const summary = computed(() => {
  const all = slots.value
  const coming = all.filter(s => !s.past)
  const open = coming.filter(s => s.count === 0).length
  const missed = all.filter(s => s.past && s.count === 0).length
  if (!coming.length) return missed ? `This day is over. ${n(missed)} of ${n(all.length)} slots had nobody.` : `This day is over. All ${n(all.length)} slots were covered.`
  if (coming.length === all.length) return open ? `${n(open)} of ${n(all.length)} slots still open.` : `All ${n(all.length)} slots covered.`
  const left = open ? `${n(open)} of the ${n(coming.length)} slots left today are still open.` : `All ${n(coming.length)} slots left today are covered.`
  return missed ? `${left} ${n(missed)} earlier ${slotWord(missed)} had nobody.` : left
})

const people = (count: number) => count === 0 ? 'nobody' : count === 1 ? '1 person' : `${n(count)} people`

// Cells per row within an hour, by how many slots an hour holds.
const columns = computed(() => {
  const perHour = Math.round(60 / props.grid.slotMinutes)
  if (perHour > 6) return 'grid-cols-4 sm:grid-cols-6'
  if (perHour > 4) return 'grid-cols-3 sm:grid-cols-6'
  return 'grid-cols-4'
})
</script>

<template>
  <section
    class="space-y-3 border-t border-(--ui-border) pt-4"
    :aria-label="`Time slots on ${ptFormatDate(day.date, { dateStyle: 'full' })}`"
  >
    <div class="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
      <div>
        <h3 class="font-medium">
          {{ ptFormatDate(day.date, { dateStyle: 'full' }) }}
          <InfoTip>
            <p>Each box is one {{ grid.slotMinutes }}-minute slot: when it starts and how many people have committed to pray then.</p>
            <p>Highlighted boxes have nobody. Faded boxes are in the past.</p>
          </InfoTip>
        </h3>
        <p
          class="text-sm text-(--ui-text-muted)"
          aria-live="polite"
        >
          {{ summary }}
        </p>
      </div>
      <div class="space-y-1.5 text-sm">
        <p class="text-(--ui-text-muted)">
          Times in {{ tz }}
        </p>
        <USwitch
          v-if="localTz !== grid.timezone"
          v-model="useLocal"
          :label="`Show in my time zone (${localTz})`"
        />
      </div>
    </div>

    <div class="sm:columns-2 gap-x-8">
      <template
        v-for="h in hours"
        :key="h.key"
      >
        <div
          v-if="h.dateLabel"
          class="break-after-avoid pt-2 pb-1 text-xs font-medium"
        >
          {{ h.dateLabel }}
        </div>
        <div
          class="break-inside-avoid flex gap-2 py-1"
          role="group"
          :aria-label="h.label"
        >
          <div
            class="shrink-0 pt-1 text-end text-xs whitespace-nowrap text-(--ui-text-muted) tabular-nums"
            :class="hours.some(x => x.repeated) ? 'w-20' : 'w-14'"
            aria-hidden="true"
          >
            {{ h.label }}
          </div>
          <ul
            class="grid flex-1 gap-1"
            :class="columns"
          >
            <li
              v-for="s in h.slots"
              :key="s.index"
              class="flex items-baseline justify-between gap-1 rounded-sm border px-1.5 py-1 text-xs tabular-nums"
              :class="[s.count === 0 ? 'border-(--ui-warning) bg-(--ui-warning)/20 font-semibold' : 'border-(--ui-border) bg-(--ui-bg-elevated)/50', s.past ? 'opacity-50' : '']"
            >
              <span
                class="text-(--ui-text-muted)"
                aria-hidden="true"
              >{{ s.minute }}</span>
              <span aria-hidden="true">{{ s.count }}</span>
              <span class="sr-only">{{ s.time }}: {{ people(s.count) }}{{ s.past ? ', past' : '' }}</span>
            </li>
          </ul>
        </div>
      </template>
    </div>
  </section>
</template>
