<script setup lang="ts">
import type { PageView } from '~~/shared/view'

defineProps<{ page: Extract<PageView, { kind: 'between' }> }>()
const { site, st } = useSite()
const { t } = useI18n()
useHead({ title: () => site.value.name })
</script>

<template>
  <div>
    <section class="brand-bg">
      <div class="max-w-3xl mx-auto px-4 py-12 space-y-3">
        <h1 class="text-3xl sm:text-4xl font-bold">{{ site.name }}</h1>
        <p v-if="site.campaign" class="text-lg">{{ t('between.ended', { campaign: site.campaign.name }) }}</p>
      </div>
    </section>
    <div class="max-w-3xl mx-auto px-4 py-10 space-y-12">
      <section aria-labelledby="thanks-title" class="space-y-4">
        <h2 id="thanks-title" class="text-2xl font-bold">{{ t('between.thanks') }}</h2>
        <p v-if="page.endMessage" class="whitespace-pre-line text-stone-800">{{ page.endMessage }}</p>
        <UButton v-if="page.next?.kind === 'cta'" :to="page.next.url" size="xl" :label="page.next.label || t('between.cta_default')" trailing-icon="i-lucide-arrow-right" />
        <UButton v-else-if="page.next?.kind === 'join'" :to="page.next.path" size="xl" :label="t('between.keep_praying', { campaign: page.next.campaign })" trailing-icon="i-lucide-arrow-right" />
        <p v-else-if="page.next?.kind === 'praying'" class="text-lg font-medium">{{ t('between.still_praying', { campaign: page.next.campaign }) }}</p>
      </section>
      <section v-if="page.stats" aria-labelledby="results-title" class="space-y-4">
        <h2 id="results-title" class="text-2xl font-bold">{{ t('between.results') }}</h2>
        <StatsGrid :stats="page.stats" />
      </section>
      <section v-if="site.campaign?.isCurrent" aria-labelledby="notify-title" class="rounded-2xl bg-white border border-stone-200 p-6 space-y-3">
        <h2 id="notify-title" class="text-2xl font-bold">{{ t('between.notify_title') }}</h2>
        <p class="text-stone-700">{{ st('between.notify_intro', { site: site.name }) }}</p>
        <NotifyForm />
      </section>
      <section aria-labelledby="share-title" class="space-y-3">
        <h2 id="share-title" class="text-2xl font-bold">{{ st('landing.share.title') }}</h2>
        <ShareButton />
      </section>
    </div>
  </div>
</template>
