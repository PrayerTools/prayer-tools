<script setup lang="ts">
defineProps<{ token: string, valid: boolean, account: boolean }>()
const { site } = useSite()
const { t } = useI18n()
useHead({ title: () => `${t('unsubscribe.title')} · ${site.value.name}` })
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-16 space-y-4">
    <h1 class="text-3xl font-bold">{{ t('unsubscribe.title') }}</h1>
    <template v-if="valid">
      <p class="text-stone-700">{{ t('unsubscribe.body', { site: site.name }) }}</p>
      <form method="post" :action="`/u/${token}`">
        <UButton type="submit" color="error" :label="t('unsubscribe.confirm')" />
      </form>
      <section v-if="account" class="space-y-3 border-t border-stone-200 pt-6 mt-8" aria-labelledby="unsubscribe-more">
        <h2 id="unsubscribe-more" class="font-semibold">{{ t('unsubscribe.more', { site: site.name }) }}</h2>
        <div class="flex flex-wrap gap-3">
          <form method="post" :action="`/u/${token}`">
            <input type="hidden" name="scope" value="all">
            <UButton type="submit" color="error" variant="outline" :label="t('unsubscribe.all')" />
          </form>
          <form method="post" :action="`/u/${token}`">
            <input type="hidden" name="scope" value="all_emails">
            <UButton type="submit" color="error" variant="outline" :label="t('unsubscribe.all_emails')" />
          </form>
        </div>
      </section>
    </template>
    <p v-else class="text-stone-700">{{ t('notice.link_invalid') }}</p>
  </div>
</template>
