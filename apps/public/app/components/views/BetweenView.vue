<script setup lang="ts">
import type { PageView } from '~~/shared/view'

defineProps<{ page: Extract<PageView, { kind: 'between' }> }>()
const { site, st, link } = useSite()
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
        <div v-if="page.hasGuide">
          <UButton :to="link('pray', [1])" size="xl" variant="outline" icon="i-lucide-book-open" :label="t('between.guide')" />
        </div>
      </section>
      <section v-if="page.stats" aria-labelledby="results-title" class="space-y-4">
        <h2 id="results-title" class="text-2xl font-bold">{{ t('between.results') }}</h2>
        <StatsGrid :stats="page.stats" />
      </section>
      <section v-if="page.notify" aria-labelledby="notify-title" class="rounded-2xl bg-white border border-stone-200 p-6 space-y-3">
        <h2 id="notify-title" class="text-2xl font-bold">{{ t('between.notify_title') }}</h2>
        <p class="text-stone-700">{{ site.campaign?.isCurrent ? st('between.notify_intro', { site: site.name }) : t('between.notify_intro_campaign', { site: site.name, campaign: site.campaign?.name }) }}</p>
        <NotifyForm />
      </section>
      <section v-else-if="page.again" aria-labelledby="again-title" class="rounded-2xl bg-white border border-stone-200 p-6 space-y-3">
        <h2 id="again-title" class="text-2xl font-bold">{{ t('between.again_title', { campaign: page.again.campaign }) }}</h2>
        <UButton :to="page.again.path" size="xl" :label="st('landing.signup.title')" trailing-icon="i-lucide-arrow-right" />
      </section>
      <InviteCard />
    </div>
  </div>
</template>
