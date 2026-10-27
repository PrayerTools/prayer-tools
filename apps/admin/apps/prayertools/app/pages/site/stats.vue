<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { data: site, can } = usePtSite()
const { id: campaignId } = usePtCampaign()

const { data, pending, error } = useFetch<{
  totals: Record<string, number>
  series: { day: string, metric: string, value: number }[]
  dims: Record<string, { key: string, total: number }[]>
  progress: { goal: string, people: number, value: number, target: number | null, percent: number | null } | null
  coverage: { date: string, percent: number }[] | null
  campaign: { name: string, start_date: string | null, end_date: string | null, length: string } | null
  commitments: number
  prayingNow: number
  anonymousApp: number
}>('/api/pt/stats', { query: computed(() => ({ campaign: campaignId.value })), key: computed(() => `pt-stats-${campaignId.value}`), watch: [campaignId] })

const campaign = computed(() => data.value?.campaign ?? null)
const hours = (min: number) => min >= 60 ? `${(min / 60).toLocaleString(undefined, { maximumFractionDigits: 1 })} h` : `${Math.round(min)} min`
const total = (metric: string) => data.value?.totals?.[metric] ?? 0

const metric = ref<'prayers' | 'minutes' | 'visitors' | 'signups'>('prayers')
const METRICS = [
  { label: 'Prayers', value: 'prayers', unit: 'prayers', source: 'prayers' },
  { label: 'Minutes prayed', value: 'minutes', unit: 'minutes', source: 'prayer_seconds' },
  { label: 'Visitors', value: 'visitors', unit: 'visitors', source: 'visitors' },
  { label: 'Signups', value: 'signups', unit: 'signups', source: 'signups' }
]
const metricInfo = computed(() => METRICS.find(m => m.value === metric.value)!)
// Daily values for the chosen metric over the last 60 days, days without activity as 0.
const points = computed(() => {
  const info = metricInfo.value
  const byDay = new Map((data.value?.series ?? []).filter(s => s.metric === info.source).map(s => [s.day, s.value]))
  if (!byDay.size) return []
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const end = new Date(`${iso(new Date())}T00:00:00Z`)
  const earliest = new Date(`${[...byDay.keys()].sort()[0]}T00:00:00Z`)
  const start = new Date(Math.max(earliest.getTime(), end.getTime() - 59 * 86400000))
  const out: { day: string, value: number }[] = []
  for (let d = start; d <= end; d = new Date(d.getTime() + 86400000)) {
    const v = byDay.get(iso(d)) ?? 0
    out.push({ day: iso(d), value: info.source === 'prayer_seconds' ? Math.round(v / 60) : v })
  }
  return out
})

async function downloadIntercessors() {
  const res = await $fetch.raw<Blob>('/api/pt/export.csv', { responseType: 'blob' })
  const url = URL.createObjectURL(res._data!)
  const a = document.createElement('a')
  a.href = url
  a.download = `${site.value?.org.slug}-intercessors.csv`
  a.click()
  URL.revokeObjectURL(url)
}

const DIM_LABELS: Record<string, string> = { country: 'Countries', source: 'Sources', utm_source: 'Campaign sources (UTM)', referrer: 'Referring sites' }
const DIM_ICONS: Record<string, string> = { country: 'i-lucide-globe', source: 'i-lucide-signpost', utm_source: 'i-lucide-megaphone', referrer: 'i-lucide-link' }
</script>

<template>
  <div class="max-w-6xl mx-auto space-y-6">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div class="flex flex-wrap items-center gap-3">
          <h1 class="text-2xl font-bold">
            Stats
          </h1>
          <PtCampaignSwitcher />
        </div>
        <p class="text-sm text-(--ui-text-muted)">
          <template v-if="campaign">
            {{ campaign.name }}: {{ ptFormatDate(campaign.start_date) }} – {{ campaign.end_date ? ptFormatDate(campaign.end_date) : 'ongoing' }}
          </template>
          <template v-else>
            All time
          </template>
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton
          v-if="can('pt.intercessors.export')"
          icon="i-lucide-download"
          variant="soft"
          color="neutral"
          label="Export intercessors"
          @click="downloadIntercessors"
        />
      </div>
    </header>

    <UAlert
      v-if="site && !can('pt.stats.read')"
      color="neutral"
      variant="subtle"
      icon="i-lucide-lock"
      title="You don’t have permission to see stats."
    />
    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Stats could not be loaded."
      :description="ptErrorMessage(error)"
    />

    <template v-else-if="data">
      <div
        class="grid gap-4 grid-cols-2 lg:grid-cols-4"
        :class="pending ? 'opacity-60' : ''"
      >
        <UCard>
          <div class="text-sm text-(--ui-text-muted)">
            People praying
          </div>
          <div class="text-3xl font-bold tabular-nums">
            {{ (data.progress?.people ?? 0).toLocaleString() }}
          </div>
          <div class="text-xs text-(--ui-text-muted)">
            {{ campaign?.length === 'fixed' ? 'committed to this campaign' : 'with active prayer times' }}
          </div>
        </UCard>
        <UCard>
          <div class="text-sm text-(--ui-text-muted)">
            Praying now
          </div>
          <div class="text-3xl font-bold tabular-nums flex items-center gap-2">
            {{ data.prayingNow.toLocaleString() }}
            <span
              v-if="data.prayingNow"
              class="size-2 rounded-full bg-(--ui-success) animate-pulse"
              aria-hidden="true"
            />
          </div>
          <div class="text-xs text-(--ui-text-muted)">
            in an open prayer session
          </div>
        </UCard>
        <UCard>
          <div class="text-sm text-(--ui-text-muted)">
            Prayer times
          </div>
          <div class="text-3xl font-bold tabular-nums">
            {{ data.commitments.toLocaleString() }}
          </div>
          <div class="text-xs text-(--ui-text-muted)">
            chosen by intercessors
          </div>
        </UCard>
        <UCard>
          <div class="text-sm text-(--ui-text-muted)">
            Joined through shares
          </div>
          <div class="text-3xl font-bold tabular-nums">
            {{ total('share_signups').toLocaleString() }}
          </div>
          <div class="text-xs text-(--ui-text-muted)">
            from {{ total('shares').toLocaleString() }} shares
          </div>
        </UCard>
      </div>

      <UCard v-if="data.progress">
        <template #header>
          <h2 class="font-semibold">
            Goal: {{ PT_LABELS.goal[data.progress.goal] }}
          </h2>
        </template>
        <div class="space-y-4">
          <div class="flex flex-wrap items-baseline gap-x-3">
            <template v-if="data.progress.goal === 'people'">
              <span class="text-3xl font-bold tabular-nums">{{ data.progress.people.toLocaleString() }}</span>
              <span class="text-sm text-(--ui-text-muted)">
                people<template v-if="data.progress.target"> of {{ data.progress.target.toLocaleString() }}</template>
              </span>
            </template>
            <template v-else-if="data.progress.goal === 'prayer_time'">
              <span class="text-3xl font-bold tabular-nums">{{ Math.round(data.progress.percent ?? 0) }}%</span>
              <span class="text-sm text-(--ui-text-muted)">
                {{ hours(data.progress.value) }} of {{ hours(data.progress.target ?? 1440) }} committed per day
              </span>
            </template>
            <template v-else>
              <span class="text-3xl font-bold tabular-nums">{{ Math.round(data.progress.value) }}%</span>
              <span class="text-sm text-(--ui-text-muted)">of the time covered by at least one person</span>
            </template>
          </div>
          <UProgress
            v-if="data.progress.percent !== null"
            :model-value="Math.min(100, data.progress.percent)"
            :aria-label="`${Math.round(data.progress.percent)}% of the goal`"
          />
          <PtCoverageCalendar
            v-if="data.coverage?.length"
            :days="data.coverage"
            :today="new Date().toISOString().slice(0, 10)"
          />
        </div>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="font-semibold">
              Prayer activity
            </h2>
            <USelect
              v-model="metric"
              :items="METRICS.map(m => ({ label: m.label, value: m.value }))"
              class="w-48"
              aria-label="Measure"
            />
          </div>
        </template>
        <div class="space-y-6">
          <div class="grid gap-4 grid-cols-2 sm:grid-cols-4 text-sm">
            <div>
              <div class="text-2xl font-semibold tabular-nums">
                {{ total('prayers').toLocaleString() }}
              </div>
              <div class="text-(--ui-text-muted)">
                prayers
              </div>
            </div>
            <div>
              <div class="text-2xl font-semibold tabular-nums">
                {{ hours(total('prayer_seconds') / 60) }}
              </div>
              <div class="text-(--ui-text-muted)">
                prayed
              </div>
            </div>
            <div>
              <div class="text-2xl font-semibold tabular-nums">
                {{ total('group_prayers').toLocaleString() }}
              </div>
              <div class="text-(--ui-text-muted)">
                praying as a group
              </div>
            </div>
            <div>
              <div class="text-2xl font-semibold tabular-nums">
                {{ total('stories').toLocaleString() }}
              </div>
              <div class="text-(--ui-text-muted)">
                stories
              </div>
            </div>
          </div>
          <PtBarChart
            :points="points"
            :unit="metricInfo.unit"
            :title="`${metricInfo.label} per day`"
          />
        </div>
      </UCard>

      <div class="grid gap-4 sm:grid-cols-2">
        <UCard>
          <template #header>
            <h2 class="font-semibold">
              Intercessors
            </h2>
          </template>
          <dl class="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt class="text-(--ui-text-muted)">
                People signed up
              </dt>
              <dd class="text-lg font-semibold tabular-nums">
                {{ (data.progress?.people ?? 0).toLocaleString() }}
              </dd>
            </div>
            <div>
              <dt class="text-(--ui-text-muted)">
                Anonymous app users
              </dt>
              <dd class="text-lg font-semibold tabular-nums">
                {{ data.anonymousApp.toLocaleString() }}
              </dd>
            </div>
            <div>
              <dt class="text-(--ui-text-muted)">
                Signups
              </dt>
              <dd class="text-lg font-semibold tabular-nums">
                {{ total('signups').toLocaleString() }}
              </dd>
            </div>
            <div>
              <dt class="text-(--ui-text-muted)">
                Confirmed emails
              </dt>
              <dd class="text-lg font-semibold tabular-nums">
                {{ total('verifications').toLocaleString() }}
              </dd>
            </div>
          </dl>
        </UCard>
        <UCard>
          <template #header>
            <h2 class="font-semibold">
              Site visits
            </h2>
          </template>
          <dl class="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt class="text-(--ui-text-muted)">
                Visitors
              </dt>
              <dd class="text-lg font-semibold tabular-nums">
                {{ total('visitors').toLocaleString() }}
              </dd>
            </div>
            <div>
              <dt class="text-(--ui-text-muted)">
                Page views
              </dt>
              <dd class="text-lg font-semibold tabular-nums">
                {{ total('pageviews').toLocaleString() }}
              </dd>
            </div>
            <div>
              <dt class="text-(--ui-text-muted)">
                Shares
              </dt>
              <dd class="text-lg font-semibold tabular-nums">
                {{ total('shares').toLocaleString() }}
              </dd>
            </div>
            <div>
              <dt class="text-(--ui-text-muted)">
                Joined through shares
              </dt>
              <dd class="text-lg font-semibold tabular-nums">
                {{ total('share_signups').toLocaleString() }}
              </dd>
            </div>
          </dl>
        </UCard>
      </div>

      <div
        v-if="Object.keys(data.dims).length"
        class="grid gap-4 sm:grid-cols-2"
      >
        <UCard
          v-for="(rows, dim) in data.dims"
          :key="dim"
        >
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon
                :name="DIM_ICONS[dim] ?? 'i-lucide-chart-bar'"
                class="size-4 text-(--ui-text-muted)"
              />
              <h2 class="font-semibold">
                {{ DIM_LABELS[dim] ?? dim }}
              </h2>
            </div>
          </template>
          <ul class="space-y-1.5 text-sm">
            <li
              v-for="r in rows"
              :key="r.key"
              class="relative flex justify-between gap-3 rounded px-2 py-1"
            >
              <span
                class="absolute inset-y-0 start-0 rounded bg-(--ui-primary)/10"
                :style="{ width: `${Math.max(2, r.total / (rows[0]?.total || 1) * 100)}%` }"
                aria-hidden="true"
              />
              <span class="relative truncate">{{ r.key }}</span>
              <span class="relative tabular-nums">{{ r.total.toLocaleString() }}</span>
            </li>
          </ul>
        </UCard>
      </div>
    </template>
  </div>
</template>
