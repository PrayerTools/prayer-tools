<script setup lang="ts">
defineProps<{ token: string, campaign: string | null }>()
const { site } = useSite()
const { t } = useI18n()
useHead({ title: () => `${t('leave.title')} · ${site.value.name}` })
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-16 space-y-4">
    <h1 class="text-3xl font-bold">{{ t('leave.title') }}</h1>
    <template v-if="campaign">
      <p class="text-stone-700">{{ t('leave.body', { campaign, site: site.name }) }}</p>
      <form method="post" :action="`/l/${token}`">
        <UButton type="submit" color="error" :label="t('leave.confirm', { campaign })" />
      </form>
    </template>
    <p v-else class="text-stone-700">{{ t('notice.link_invalid') }}</p>
  </div>
</template>
