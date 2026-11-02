<script setup lang="ts">
const props = defineProps<{ noticeKey: string }>()
const { site, link } = useSite()
const { t } = useI18n()
useHead({ title: () => site.value.name })
const icon = computed(() => props.noticeKey.startsWith('checkin_') || props.noticeKey === 'unsubscribed' || props.noticeKey === 'unsubscribed_all' || props.noticeKey === 'deleted' ? 'i-lucide-check-circle' : 'i-lucide-info')
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-16 space-y-6">
    <UAlert :icon="icon" color="neutral" variant="soft" :title="t(`notice.${noticeKey}`, { site: site.name })" role="status" />
    <div class="flex flex-wrap gap-3">
      <UButton :to="link('', [], { current: true })" variant="outline" :label="t('notfound.home')" />
      <UButton v-if="noticeKey === 'checkin_yes' || noticeKey === 'checkin_sometimes'" :to="link('pray', [], { current: true })" :label="t('landing.pray_today')" />
    </div>
  </div>
</template>
