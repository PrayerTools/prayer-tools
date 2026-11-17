<script setup lang="ts">
import type { GoalProgressView } from '~~/shared/view'
import { slotsInRange } from '@prayertools/shared/coverage'
import { browserTimezone } from '~/utils/commitment'

defineProps<{ progress: GoalProgressView | null }>()
const { site, link, num } = useSite()
const { t } = useI18n()
useHead({ title: () => `${t('coverage.title')} · ${site.value.name}` })

interface CoverageData {
  start: string
  slotMinutes: number
  timezone: string
  days: { date: string, percent: number, from: number, to: number }[]
  slots: number[]
}

const { data } = await useFetch<CoverageData>('/api/coverage.json', { query: { campaign: site.value.campaign?.id }, server: false })
const selectedDay = ref<string | null>(null)
const useLocal = ref(true)
const localTz = ref('UTC')
const picks = ref<string[]>([])

onMounted(() => {
  localTz.value = browserTimezone()
  try {
    picks.value = JSON.parse(sessionStorage.getItem(`pt_picks:${site.value.orgId}`) ?? '[]')
  } catch {
    picks.value = []
  }
})

watch(picks, (v) => {
  try {
    sessionStorage.setItem(`pt_picks:${site.value.orgId}`, JSON.stringify(v))
  } catch {
    // storage blocked
  }
}, { deep: true })

const tz = computed(() => (useLocal.value ? localTz.value : data.value?.timezone) || 'UTC')
const showToggle = computed(() => !!data.value && localTz.value !== data.value.timezone)

const day = computed(() => data.value?.days.find(d => d.date === selectedDay.value) ?? null)

const slots = computed(() => {
  if (!data.value || !day.value) return []
  const fmt = new Intl.DateTimeFormat(site.value.lang, { hour: 'numeric', minute: '2-digit', timeZone: tz.value })
  return slotsInRange(data.value, day.value.from, day.value.to).map((s) => {
    const iso = s.at.toISOString()
    return { i: s.index, iso, label: fmt.format(s.at), count: s.count, past: s.past, picked: picks.value.includes(iso) }
  })
})

function dayLabel(date: string): string {
  return new Intl.DateTimeFormat(site.value.lang, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
}

function toggle(iso: string) {
  picks.value = picks.value.includes(iso) ? picks.value.filter(p => p !== iso) : [...picks.value, iso].sort()
}

const signupLink = computed(() => `${link('signup')}?slots=${encodeURIComponent(picks.value.join(','))}`)
</script>

<template>
  <div class="max-w-5xl mx-auto px-4 py-10 space-y-6">
    <header class="space-y-2">
      <h1 class="text-3xl font-bold">{{ t('coverage.title') }}</h1>
      <p class="text-stone-700">{{ t('coverage.intro') }}</p>
    </header>
    <GoalProgress v-if="progress" :progress="progress" />

    <div v-if="showToggle" class="flex items-center gap-3">
      <USwitch v-model="useLocal" :label="t('coverage.local_time', { tz: localTz })" />
    </div>
    <p class="text-sm text-stone-600">{{ t('coverage.times_in', { tz }) }}</p>

    <p v-if="!data" class="text-stone-600">{{ t('common.loading') }}</p>
    <template v-else>
      <ul class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2" :aria-label="t('coverage.days')">
        <li v-for="d in data.days" :key="d.date">
          <button
            type="button"
            class="w-full rounded-lg border p-3 text-start transition"
            :class="selectedDay === d.date ? 'border-(--brand) ring-2 ring-(--brand)' : 'border-stone-200 bg-white hover:border-stone-400'"
            :aria-pressed="selectedDay === d.date"
            @click="selectedDay = d.date"
          >
            <span class="block text-sm font-medium">{{ dayLabel(d.date) }}</span>
            <span class="block text-lg font-bold">{{ num(d.percent) }}%</span>
            <span class="block h-1.5 mt-1 rounded bg-stone-200 overflow-hidden"><span class="block h-full bg-(--brand)" :style="{ width: `${d.percent}%` }" /></span>
          </button>
        </li>
      </ul>

      <section v-if="day" class="space-y-3" :aria-label="dayLabel(day.date)">
        <h2 class="text-xl font-semibold">{{ dayLabel(day.date) }}</h2>
        <p class="text-sm text-stone-600">{{ t('coverage.pick_help') }}</p>
        <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-1.5">
          <button
            v-for="s in slots"
            :key="s.i"
            type="button"
            :disabled="s.past"
            :aria-pressed="s.picked"
            class="rounded border px-2 py-1.5 text-sm flex justify-between gap-2 disabled:opacity-40"
            :class="s.picked ? 'bg-(--brand) text-(--brand-text) border-(--brand)' : s.count === 0 ? 'bg-amber-50 border-amber-300' : 'bg-white border-stone-200'"
            @click="toggle(s.iso)"
          >
            <span>{{ s.label }}</span>
            <span :aria-label="t('coverage.people_in_slot', { n: s.count })">{{ s.count }}</span>
          </button>
        </div>
      </section>

      <div v-if="picks.length" class="sticky bottom-4 rounded-xl bg-white border border-stone-300 shadow-lg p-4 flex flex-wrap items-center gap-3">
        <span class="font-medium">{{ t('coverage.picked', { n: picks.length }, picks.length) }}</span>
        <UButton :to="signupLink" :label="t('coverage.signup_picked')" trailing-icon="i-lucide-arrow-right" />
        <UButton variant="ghost" color="neutral" :label="t('coverage.clear')" @click="picks = []" />
      </div>
    </template>
  </div>
</template>
