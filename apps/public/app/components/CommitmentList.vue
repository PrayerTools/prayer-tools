<script setup lang="ts">
// A person's prayer times with edit / pause / remove, and adding a new one.
// The parent performs the API calls.
import type { CommitmentView } from '~~/shared/view'
import type { Cadence } from '@prayertools/shared/db/schema'
import { describeRule, formatMinutes, formatTime, monthDayKey, newCommitment, weekdayList, type CommitmentInput } from '~/utils/commitment'

const props = defineProps<{
  commitments: CommitmentView[]
  cadence: Cadence
  durationRule: 'required' | 'optional' | 'hidden'
  durations: number[]
  defaultDuration: number
  canAdd: boolean
  lang: string
  icsBase?: string
  busy?: boolean
}>()
const emit = defineEmits<{
  add: [input: CommitmentInput]
  update: [id: string, input: CommitmentInput]
  pause: [id: string, paused: boolean]
  remove: [id: string]
}>()
const { t } = useI18n()

const editing = ref<string | null>(null)
const draft = ref<CommitmentInput>(newCommitment(props.durationRule, props.defaultDuration, props.cadence))
const adding = ref(false)

function startEdit(c: CommitmentView) {
  editing.value = c.id
  adding.value = false
  draft.value = { frequency: c.frequency ?? 'daily', days_of_week: [...c.daysOfWeek], day_of_month: c.dayOfMonth, time: c.time, duration_min: c.durationMin }
}

function startAdd() {
  editing.value = null
  adding.value = true
  draft.value = newCommitment(props.durationRule, props.defaultDuration, props.cadence)
}

function save() {
  if (adding.value) emit('add', { ...draft.value })
  else if (editing.value) emit('update', editing.value, { ...draft.value })
  editing.value = null
  adding.value = false
}

function dateList(c: CommitmentView): string[] {
  const fmt = new Intl.DateTimeFormat(props.lang, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: c.timezone })
  return c.dates.map(d => fmt.format(new Date(d)))
}

function days(c: CommitmentView): string {
  if (c.frequency === 'monthly') return t(monthDayKey(c))
  return c.frequency === 'daily' ? t('commitment.daily') : weekdayList(c.daysOfWeek, props.lang)
}

function details(c: CommitmentView): string {
  return [c.durationMin ? formatMinutes(c.durationMin, props.lang) : null, c.timezone].filter(Boolean).join(' · ')
}

function menu(c: CommitmentView) {
  return [
    [
      { label: c.paused ? t('manage.resume') : t('manage.pause'), icon: c.paused ? 'i-lucide-play' : 'i-lucide-pause', onSelect: () => emit('pause', c.id, !c.paused) },
      ...(props.icsBase ? [{ label: t('manage.add_to_calendar'), icon: 'i-lucide-calendar-plus', to: `${props.icsBase}/${c.id}.ics`, external: true }] : [])
    ],
    [{ label: t('manage.remove'), icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => emit('remove', c.id) }]
  ]
}
</script>

<template>
  <div>
    <p v-if="!commitments.length && !adding" class="py-4 text-stone-600">{{ t('manage.no_times') }}</p>
    <ul>
      <li v-for="c in commitments" :key="c.id" class="py-4 space-y-4 border-stone-200 not-first:border-t">
        <div class="flex flex-wrap items-start gap-x-4 gap-y-3">
          <p v-if="c.kind === 'recurring'" class="w-28 shrink-0 text-2xl font-semibold leading-8 tabular-nums" :class="c.paused && 'text-stone-500'">
            {{ formatTime(c.time, lang) }}
          </p>
          <div class="min-w-0 flex-1 basis-40">
            <p class="flex flex-wrap items-center gap-2 font-medium leading-8">
              {{ c.kind === 'recurring' ? days(c) : describeRule(c, lang, t) }}
              <UBadge v-if="c.paused" color="warning" variant="soft" size="sm" icon="i-lucide-pause" :label="t('manage.paused')" />
            </p>
            <p class="text-sm text-stone-600">{{ details(c) }}</p>
          </div>
          <div v-if="!c.campaignEnded && editing !== c.id" class="flex items-center gap-1 ms-auto">
            <UButton v-if="c.kind === 'recurring'" size="sm" variant="outline" color="neutral" icon="i-lucide-pencil" :label="t('manage.change')" @click="startEdit(c)" />
            <UDropdownMenu :items="menu(c)" :content="{ align: 'end' }">
              <UButton size="sm" variant="ghost" color="neutral" icon="i-lucide-ellipsis" :aria-label="t('manage.more_actions')" :title="t('manage.more_actions')" />
            </UDropdownMenu>
          </div>
        </div>
        <ul v-if="c.kind === 'dates' && c.dates.length" class="flex flex-wrap gap-1.5">
          <li v-for="d in dateList(c)" :key="d" class="rounded-md bg-[color-mix(in_srgb,currentColor_6%,transparent)] px-2 py-0.5 text-sm tabular-nums">{{ d }}</li>
        </ul>
        <div v-if="editing === c.id" class="space-y-4 rounded-lg bg-[color-mix(in_srgb,currentColor_4%,transparent)] p-4">
          <CommitmentFields v-model="draft" :duration-rule="durationRule" :durations="durations" :id-prefix="`e-${c.id}`" :lang="lang" :cadence="cadence" />
          <div class="flex gap-2">
            <UButton :loading="busy" :label="t('common.save')" @click="save" />
            <UButton variant="ghost" color="neutral" :label="t('common.cancel')" @click="editing = null" />
          </div>
        </div>
      </li>
    </ul>
    <div v-if="adding" class="space-y-4 border-stone-200 py-4" :class="commitments.length > 0 && 'border-t'">
      <CommitmentFields v-model="draft" :duration-rule="durationRule" :durations="durations" id-prefix="new" :lang="lang" :cadence="cadence" />
      <div class="flex gap-2">
        <UButton :loading="busy" :label="t('manage.add_time')" @click="save" />
        <UButton variant="ghost" color="neutral" :label="t('common.cancel')" @click="adding = false" />
      </div>
    </div>
    <div v-else-if="canAdd || $slots.end" class="flex flex-wrap items-center gap-2 border-stone-200 py-3" :class="commitments.length > 0 && 'border-t'">
      <UButton v-if="canAdd" variant="ghost" icon="i-lucide-plus" class="-ms-2.5" :label="t('manage.add_time')" @click="startAdd" />
      <div v-if="$slots.end" class="ms-auto">
        <slot name="end" />
      </div>
    </div>
  </div>
</template>
