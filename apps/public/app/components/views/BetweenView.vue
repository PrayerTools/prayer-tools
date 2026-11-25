<script setup lang="ts">
import type { PageView } from '~~/shared/view'

const props = defineProps<{ page: Extract<PageView, { kind: 'between' }> }>()
const { site, st, link, moreAboutLabel } = useSite()
const { t } = useI18n()
useHead({ title: () => site.value.name })
const showProgress = computed(() => !!props.page.stats && (props.page.stats.progress.goal !== 'people' || site.value.settings.showPeopleCount))
</script>

<template>
  <div>
    <CampaignHero title-id="ended-title">
      <div class="space-y-5">
        <!-- The header already shows the site name, so the band is titled with the campaign's. -->
        <h1 id="ended-title" class="text-3xl sm:text-5xl font-bold leading-tight text-balance">{{ site.campaign?.name ?? site.name }}</h1>
        <p v-if="site.campaign" class="text-xl sm:text-2xl font-semibold text-balance">{{ t('between.ended_short') }}</p>
        <NuxtLink :to="link('about')" class="inline-flex items-center gap-1.5 font-medium underline underline-offset-4 decoration-current/40 hover:decoration-current">
          {{ moreAboutLabel(page.template) }}<UIcon name="i-lucide-arrow-right" class="size-4 rtl:rotate-180" />
        </NuxtLink>
      </div>
    </CampaignHero>
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
        <div class="space-y-6 text-center">
          <div v-if="showProgress" class="rounded-xl border border-stone-200 bg-white px-5 py-6 shadow-[0_1px_3px_rgb(28_25_23/0.05)] sm:px-8 sm:py-8">
            <GoalProgress :progress="page.stats.progress" class="mx-auto max-w-sm" />
          </div>
          <StatsGrid :stats="page.stats" hide-progress />
        </div>
      </section>
      <section aria-labelledby="story-title" class="space-y-4 rounded-xl border border-stone-200 bg-white px-5 py-8 text-center shadow-[0_1px_3px_rgb(28_25_23/0.05)] sm:px-8">
        <h2 id="story-title" class="text-2xl font-bold text-balance">{{ t('between.story_title') }}</h2>
        <p class="mx-auto max-w-prose text-stone-700">{{ t('stories.intro', { site: site.name }) }}</p>
        <div class="mx-auto max-w-xl text-start">
          <StoryForm centered />
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
