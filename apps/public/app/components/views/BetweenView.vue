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
      <div class="max-w-3xl mx-auto px-4 py-12 space-y-3 text-center">
        <h1 class="text-3xl sm:text-4xl font-bold text-balance">{{ site.name }}</h1>
        <p v-if="site.campaign" class="text-lg">{{ t('between.ended', { campaign: site.campaign.name }) }}</p>
      </div>
    </section>
    <div class="max-w-3xl mx-auto px-4 py-10 space-y-14">
      <section aria-labelledby="thanks-title">
        <LandingHeading :title="t('between.thanks')" title-id="thanks-title" />
        <div v-if="page.endMessage || page.next || page.hasGuide" class="space-y-6 rounded-xl border border-stone-200 bg-white px-5 py-8 text-center shadow-[0_1px_3px_rgb(28_25_23/0.05)] sm:px-8">
          <p v-if="page.endMessage" class="mx-auto max-w-prose whitespace-pre-line text-lg text-stone-800">{{ page.endMessage }}</p>
          <p v-if="page.next?.kind === 'praying'" class="text-lg font-medium">{{ t('between.still_praying', { campaign: page.next.campaign }) }}</p>
          <div v-if="page.next?.kind === 'cta' || page.next?.kind === 'join' || page.hasGuide" class="flex flex-wrap justify-center gap-3">
            <UButton v-if="page.next?.kind === 'cta'" :to="page.next.url" size="xl" :label="page.next.label || t('between.cta_default')" trailing-icon="i-lucide-arrow-right" />
            <UButton v-else-if="page.next?.kind === 'join'" :to="page.next.path" size="xl" :label="t('between.keep_praying', { campaign: page.next.campaign })" trailing-icon="i-lucide-arrow-right" />
            <UButton v-if="page.hasGuide" :to="link('pray', [1])" size="xl" variant="outline" icon="i-lucide-book-open" :label="t('between.guide')" />
          </div>
        </div>
      </section>
      <section v-if="page.stats" aria-labelledby="results-title">
        <LandingHeading :title="t('between.results')" title-id="results-title" />
        <div class="text-center">
          <StatsGrid :stats="page.stats" />
        </div>
      </section>
      <section v-if="page.notify" aria-labelledby="notify-title" class="space-y-4 rounded-xl border border-stone-200 bg-white px-5 py-8 text-center shadow-[0_1px_3px_rgb(28_25_23/0.05)] sm:px-8">
        <h2 id="notify-title" class="text-2xl font-bold text-balance">{{ t('between.notify_title') }}</h2>
        <p class="mx-auto max-w-prose text-stone-700">{{ site.campaign?.isCurrent ? st('between.notify_intro', { site: site.name }) : t('between.notify_intro_campaign', { site: site.name, campaign: site.campaign?.name }) }}</p>
        <div class="mx-auto max-w-xl text-start">
          <NotifyForm />
        </div>
      </section>
      <section v-else-if="page.again" aria-labelledby="again-title" class="space-y-4 rounded-xl border border-stone-200 bg-white px-5 py-8 text-center shadow-[0_1px_3px_rgb(28_25_23/0.05)] sm:px-8">
        <h2 id="again-title" class="text-2xl font-bold text-balance">{{ t('between.again_title', { campaign: page.again.campaign }) }}</h2>
        <UButton :to="page.again.path" size="xl" :label="st('landing.signup.title')" trailing-icon="i-lucide-arrow-right" />
      </section>
      <InviteCard centered />
    </div>
  </div>
</template>
