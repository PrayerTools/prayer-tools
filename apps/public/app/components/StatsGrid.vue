<script setup lang="ts">
import type { StatsView } from '~~/shared/view'

const props = defineProps<{ stats: StatsView }>()
const { site, num, minutes } = useSite()
const { t } = useI18n()

const tiles = computed(() => {
  const s = props.stats
  const out = [
    { label: t('stats.commitments'), value: num(s.commitments) },
    { label: t('stats.prayers'), value: num(s.prayers) },
    { label: t('stats.minutes'), value: minutes(s.prayerMinutes) },
    { label: t('stats.share_signups'), value: num(s.shareSignups) }
  ]
  if (site.value.settings.showPeopleCount) {
    if (s.signedUp !== null) out.unshift({ label: t('stats.signed_up_total'), value: num(s.signedUp) })
    out.unshift({ label: t('stats.people'), value: num(s.progress.people) })
  }
  if (s.groupPrayers) out.push({ label: t('stats.group_prayers'), value: num(s.groupPrayers) })
  if (site.value.settings.showPrayingNow) out.push({ label: t('stats.praying_now'), value: num(s.prayingNow) })
  return out
})
</script>

<template>
  <div class="space-y-6">
    <GoalProgress :progress="stats.progress" />
    <dl class="grid grid-cols-2 sm:grid-cols-3 gap-4">
      <div v-for="tile in tiles" :key="tile.label" class="rounded-xl bg-white border border-stone-200 p-4">
        <dt class="text-sm text-stone-600">{{ tile.label }}</dt>
        <dd class="text-2xl font-bold mt-1">{{ tile.value }}</dd>
      </div>
    </dl>
  </div>
</template>
