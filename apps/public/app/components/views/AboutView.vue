<script setup lang="ts">
import type { PageView } from '~~/shared/view'

defineProps<{ page: Extract<PageView, { kind: 'about' }> }>()
const { site, link, aboutTitle } = useSite()
const { t } = useI18n()
const name = computed(() => site.value.campaign?.name ?? site.value.name)
useHead({ title: () => `${t('nav.about')} · ${name.value}` })
</script>

<template>
  <div>
    <header class="brand-bg">
      <div class="max-w-3xl mx-auto px-4 py-12 text-center space-y-2">
        <p class="text-sm font-semibold uppercase tracking-wider opacity-90">{{ t('nav.about') }}</p>
        <h1 class="text-3xl sm:text-4xl font-bold text-balance">{{ name }}</h1>
      </div>
    </header>
    <div class="max-w-3xl mx-auto px-4 py-10 space-y-14">
      <section v-if="page.about" aria-labelledby="about-title" class="text-center">
        <LandingHeading :title="aboutTitle(page.template)" title-id="about-title" />
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div class="pt-content pt-centered mx-auto max-w-prose" v-html="page.about" />
      </section>

      <section v-if="page.together" aria-labelledby="together-title" class="text-center">
        <LandingHeading :title="t('about.together_title')" title-id="together-title" />
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div class="pt-content pt-centered mx-auto max-w-prose" v-html="page.together" />
      </section>

      <section aria-labelledby="prayertools-title" class="text-center">
        <LandingHeading :title="t('about.prayertools_title')" title-id="prayertools-title" />
        <p class="mx-auto max-w-prose whitespace-pre-line text-lg leading-[1.75] text-stone-800">{{ t('about.prayertools_body') }}</p>
        <UButton :href="site.donateUrl" variant="outline" icon="i-lucide-heart" :label="t('footer.give')" class="mt-6" />
      </section>

      <div class="flex justify-center">
        <UButton :to="link()" size="xl" :label="t('about.back', { campaign: name })" icon="i-lucide-arrow-left" :ui="{ leadingIcon: 'rtl:rotate-180' }" />
      </div>
    </div>
  </div>
</template>
