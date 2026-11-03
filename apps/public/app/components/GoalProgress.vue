<script setup lang="ts">
import type { GoalProgressView } from '~~/shared/view'

const props = defineProps<{ progress: GoalProgressView, onBrand?: boolean }>()
const { site, num, minutes } = useSite()
const { t } = useI18n()

// People counts read as signed up before the campaign starts and prayed once it has ended.
const suffix = computed(() => {
  const state = site.value.campaign?.state
  return state === 'upcoming' ? '_upcoming' : state === 'ended' || state === 'between' ? '_ended' : ''
})
const people = computed(() => t(`progress.people${suffix.value}`, { n: num(props.progress.people) }, props.progress.people))

const label = computed(() => {
  const p = props.progress
  if (p.goal === 'coverage') return t('progress.coverage', { percent: num(p.value) })
  if (p.goal === 'prayer_time') return t('progress.prayer_time', { minutes: minutes(p.value), target: minutes(p.target ?? 1440) })
  return p.target ? t(`progress.people_target${suffix.value}`, { n: num(p.people), target: num(p.target) }) : people.value
})

const showPeople = computed(() => site.value.settings.showPeopleCount)
const showBar = computed(() => props.progress.percent !== null && (props.progress.goal !== 'people' || showPeople.value))
</script>

<template>
  <div v-if="progress.goal !== 'people' || showPeople" class="space-y-2">
    <p class="text-lg font-semibold">{{ label }}</p>
    <div
      v-if="showBar"
      class="h-3 rounded-full overflow-hidden"
      :class="onBrand ? 'bg-white/30' : 'bg-stone-200'"
      role="progressbar"
      :aria-valuenow="progress.percent ?? 0"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="label"
    >
      <div class="h-full rounded-full" :class="onBrand ? 'bg-(--brand-text)' : 'bg-(--brand)'" :style="{ width: `${progress.percent ?? 0}%` }" />
    </div>
    <p v-if="progress.goal !== 'people' && showPeople" class="text-sm opacity-90">{{ people }}</p>
  </div>
</template>
