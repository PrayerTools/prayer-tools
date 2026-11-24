<script setup lang="ts">
import type { CampaignRunView } from '~~/shared/view'

const props = defineProps<{ calendar: NonNullable<CampaignRunView['calendar']>, today: string }>()
const { site, num } = useSite()
const { t } = useI18n()

// 0 = Sunday … 6 = Saturday, as the page language's calendars start the week.
const firstDay = computed(() => {
  try {
    const locale = new Intl.Locale(site.value.lang) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }, weekInfo?: { firstDay: number } }
    const day = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay
    return day ? day % 7 : 0
  } catch {
    return 0
  }
})

// 2026-01-04 is a Sunday.
const weekdays = computed(() => {
  const short = new Intl.DateTimeFormat(site.value.lang, { weekday: 'narrow', timeZone: 'UTC' })
  const long = new Intl.DateTimeFormat(site.value.lang, { weekday: 'long', timeZone: 'UTC' })
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, 4 + (firstDay.value + i) % 7))
    return { short: short.format(d), long: long.format(d) }
  })
})

const byDate = computed(() => new Map(props.calendar.days.map(d => [d.date, d.percent])))

interface Cell { date: string, n: string, inRun: boolean, percent: number | null, past: boolean, today: boolean, label: string }

const months = computed(() => {
  const title = new Intl.DateTimeFormat(site.value.lang, { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const dayLabel = new Intl.DateTimeFormat(site.value.lang, { month: 'long', day: 'numeric', timeZone: 'UTC' })
  return props.calendar.months.map((first) => {
    const y = +first.slice(0, 4)
    const m = +first.slice(5, 7)
    const count = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() - firstDay.value + 7) % 7
    const cells: (Cell | null)[] = Array.from({ length: lead }, () => null)
    for (let d = 1; d <= count; d++) {
      const date = `${first.slice(0, 8)}${String(d).padStart(2, '0')}`
      const inRun = byDate.value.has(date)
      cells.push({ date, n: num(d), inRun, percent: byDate.value.get(date) ?? null, past: date < props.today, today: date === props.today, label: dayLabel.format(new Date(`${date}T00:00:00Z`)) })
    }
    while (cells.length % 7) cells.push(null)
    const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7))
    return { key: first, title: title.format(new Date(`${first}T00:00:00Z`)), weeks }
  })
})
</script>

<template>
  <div class="grid gap-6" :class="months.length > 1 && 'sm:grid-cols-2'">
    <table v-for="month in months" :key="month.key" class="w-full max-w-xs table-fixed border-separate border-spacing-1 justify-self-center">
      <caption class="pb-2 font-semibold">{{ month.title }}</caption>
      <thead>
        <tr>
          <th v-for="w in weekdays" :key="w.long" scope="col" class="pb-1 text-xs font-medium text-stone-600">
            <span aria-hidden="true">{{ w.short }}</span><span class="sr-only">{{ w.long }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(week, i) in month.weeks" :key="i">
          <td v-for="(cell, j) in week" :key="j" class="p-0 text-center">
            <template v-if="cell">
              <div
                v-if="cell.inRun"
                class="relative mx-auto flex size-9 items-center justify-center rounded-full text-sm tabular-nums"
                :class="[cell.today ? (cell.percent === null ? 'bg-primary font-bold text-inverted' : 'bg-primary/15 font-bold') : cell.percent === null && 'bg-primary/10', cell.past && !cell.today && 'opacity-55']"
                :title="cell.percent === null ? undefined : `${cell.label}: ${num(cell.percent)}%`"
              >
                <svg v-if="cell.percent !== null" viewBox="0 0 36 36" class="absolute inset-0 size-full -rotate-90" aria-hidden="true">
                  <circle cx="18" cy="18" r="15.9155" fill="none" stroke="currentColor" stroke-width="3" class="text-stone-500" stroke-opacity="0.2" />
                  <circle v-if="cell.percent > 0" cx="18" cy="18" r="15.9155" fill="none" stroke="currentColor" stroke-width="3" class="text-primary" :stroke-dasharray="`${cell.percent} 100`" />
                </svg>
                <span class="relative" :aria-current="cell.today ? 'date' : undefined">{{ cell.n }}</span>
                <span class="sr-only">{{ cell.today ? `, ${t('landing.goal.today')}` : '' }}{{ cell.percent === null ? '' : `, ${num(cell.percent)}%` }}</span>
              </div>
              <span v-else class="flex size-9 mx-auto items-center justify-center text-sm tabular-nums text-stone-500 opacity-60">{{ cell.n }}</span>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
