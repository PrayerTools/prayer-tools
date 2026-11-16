<script setup lang="ts">
// Per-day 24/7 coverage as a month calendar; shade deepens with coverage.
// Each campaign day is a button that selects it.
const props = defineProps<{
  days: { date: string, percent: number }[]
  today?: string
}>()
const selected = defineModel<string | null>('selected', { default: null })
const root = ref<HTMLElement | null>(null)

// The one day Tab stops on; the arrow keys reach the others.
const tabStop = computed(() => props.days.some(d => d.date === selected.value) ? selected.value : props.days[0]?.date)

const KEY_STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -Infinity, End: Infinity }

function onKeydown(e: KeyboardEvent, date: string) {
  const step = KEY_STEPS[e.key]
  if (step === undefined) return
  e.preventDefault()
  const at = props.days.findIndex(d => d.date === date)
  const next = props.days[Math.min(props.days.length - 1, Math.max(0, at + step))]
  if (next) root.value?.querySelector<HTMLElement>(`[data-date="${next.date}"]`)?.focus()
}

function dayName(date: string, percent: number): string {
  return `${ptFormatDate(date, { dateStyle: 'full' })}${date === props.today ? ', today' : ''}: ${Math.round(percent)}% covered`
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const months = computed(() => {
  const byMonth = new Map<string, typeof props.days>()
  for (const d of props.days) {
    const key = d.date.slice(0, 7)
    byMonth.set(key, [...(byMonth.get(key) ?? []), d])
  }
  return [...byMonth.entries()].map(([key, list]) => {
    const first = new Date(`${key}-01T00:00:00Z`)
    const lead = (first.getUTCDay() + 6) % 7
    const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
    const byDate = new Map(list.map(d => [d.date, d]))
    const cells: ({ date: string, n: number, info: typeof list[number] | undefined } | null)[] = Array.from({ length: lead }, () => null)
    for (let n = 1; n <= daysInMonth; n++) {
      const date = `${key}-${String(n).padStart(2, '0')}`
      cells.push({ date, n, info: byDate.get(date) })
    }
    return { key, label: ptFormatDate(`${key}-01`, { month: 'long', year: 'numeric' }), cells }
  })
})

// Four shade steps of the primary color; 0% stays the plain surface.
function shade(pct: number): string {
  if (pct <= 0) return 'bg-(--ui-bg-elevated)'
  if (pct < 25) return 'bg-(--ui-primary)/20'
  if (pct < 50) return 'bg-(--ui-primary)/40'
  if (pct < 100) return 'bg-(--ui-primary)/70 text-(--ui-text-inverted)'
  return 'bg-(--ui-primary) text-(--ui-text-inverted)'
}
</script>

<template>
  <div
    ref="root"
    class="space-y-4"
  >
    <div class="flex flex-wrap items-center gap-3 text-xs text-(--ui-text-muted)">
      <span>Coverage per day:</span>
      <span class="flex items-center gap-1"><span class="size-3 rounded-sm bg-(--ui-bg-elevated) border border-(--ui-border)" /> none</span>
      <span class="flex items-center gap-1"><span class="size-3 rounded-sm bg-(--ui-primary)/20" /> under 25%</span>
      <span class="flex items-center gap-1"><span class="size-3 rounded-sm bg-(--ui-primary)/40" /> under 50%</span>
      <span class="flex items-center gap-1"><span class="size-3 rounded-sm bg-(--ui-primary)/70" /> under 100%</span>
      <span class="flex items-center gap-1"><span class="size-3 rounded-sm bg-(--ui-primary)" /> 24/7</span>
      <span class="flex items-center gap-1.5 ps-1"><span class="size-3 rounded-sm bg-(--ui-primary)/40 ring-2 ring-(--ui-text)" /> today</span>
      <span class="flex items-center gap-2 ps-1.5"><span class="size-2.5 rounded-xs bg-(--ui-primary)/40 outline-2 outline-offset-2 outline-(--ui-text)" /> selected</span>
    </div>
    <div class="grid gap-6 sm:grid-cols-2">
      <div
        v-for="m in months"
        :key="m.key"
      >
        <div class="font-medium text-sm mb-2">
          {{ m.label }}
        </div>
        <div
          class="grid grid-cols-7 gap-1.5 text-center text-xs"
          role="group"
          :aria-label="m.label"
        >
          <div
            v-for="w in WEEKDAYS"
            :key="w"
            class="text-(--ui-text-muted) pb-1"
            aria-hidden="true"
          >
            {{ w }}
          </div>
          <template
            v-for="(c, i) in m.cells"
            :key="c?.date ?? `lead-${i}`"
          >
            <div v-if="!c" />
            <button
              v-else-if="c.info"
              type="button"
              class="aspect-square rounded-sm flex flex-col items-center justify-center leading-tight cursor-pointer outline-(--ui-text) outline-offset-[3px] focus-visible:outline-2 focus-visible:outline-dashed"
              :class="[shade(c.info.percent), c.date === props.today ? 'ring-2 ring-(--ui-text)' : '', c.date === selected ? 'outline-2' : '']"
              :data-date="c.date"
              :tabindex="c.date === tabStop ? 0 : -1"
              :aria-pressed="c.date === selected"
              :aria-label="dayName(c.date, c.info.percent)"
              :title="dayName(c.date, c.info.percent)"
              @click="selected = c.date"
              @keydown="onKeydown($event, c.date)"
            >
              <span>{{ c.n }}</span>
              <span class="text-[10px] opacity-80 tabular-nums">{{ Math.round(c.info.percent) }}%</span>
            </button>
            <div
              v-else
              class="aspect-square rounded-sm flex flex-col items-center justify-center leading-tight text-(--ui-text-dimmed)"
              :class="c.date === props.today ? 'ring-2 ring-(--ui-text)' : ''"
            >
              <span>{{ c.n }}</span>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
