<script setup lang="ts">
const props = defineProps<{ page: string }>()
const { site, link, st, campaignLink } = useSite()
const { t } = useI18n()

const nav = computed(() => {
  const items = site.value.campaign?.state === 'upcoming' ? [] : [{ label: t('nav.pray'), to: link('pray') }]
  items.push({ label: t('nav.stats'), to: link('stats') })
  if (site.value.campaign?.goal === 'coverage') items.push({ label: t('nav.coverage'), to: link('coverage') })
  items.push({ label: t('nav.contact'), to: link('contact') })
  return site.value.status === 'archived' ? [] : items
})

const showFeedback = computed(() => !!site.value.feedback && props.page !== 'embed' && !site.value.editor)
</script>

<template>
  <div class="min-h-dvh flex flex-col">
    <a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:bg-white focus:px-3 focus:py-2 focus:rounded">{{ t('a11y.skip') }}</a>
    <div v-if="site.preview && !site.editor" class="bg-amber-100 text-amber-900 text-sm text-center px-4 py-2" role="status">
      {{ t('preview.banner') }}
    </div>
    <header class="brand-bg">
      <div class="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <NuxtLink :to="link('', [], { current: true })" class="flex items-center gap-3 font-bold text-lg me-auto">
          <img v-if="site.logoUrl" :src="site.logoUrl" alt="" class="h-9 w-auto">
          <span>{{ site.name }}</span>
        </NuxtLink>
        <nav :aria-label="t('nav.label')" class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <NuxtLink v-for="item in nav" :key="item.to" :to="item.to" class="underline-offset-4 hover:underline">{{ item.label }}</NuxtLink>
        </nav>
        <LanguageSwitcher />
      </div>
    </header>

    <main id="main" class="flex-1">
      <slot />
    </main>

    <footer class="border-t border-stone-200 bg-white text-sm text-stone-600">
      <div class="max-w-5xl mx-auto px-4 py-8 grid gap-6 sm:grid-cols-3">
        <div>
          <p class="font-semibold text-stone-800">{{ site.name }}</p>
          <ul class="mt-2 space-y-1">
            <li><NuxtLink :to="link('contact')" class="underline">{{ st('landing.contact.title') }}</NuxtLink></li>
            <li><NuxtLink :to="link('stories')" class="underline">{{ t('stories.share_link') }}</NuxtLink></li>
            <li><a :href="site.myUrl" class="underline">{{ t('footer.my') }}</a></li>
          </ul>
        </div>
        <div v-if="site.pastCampaigns.length">
          <p class="font-semibold text-stone-800">{{ t('footer.past') }}</p>
          <ul class="mt-2 space-y-1">
            <li v-for="c in site.pastCampaigns" :key="c.slug">
              <NuxtLink :to="campaignLink(c.slug)" class="underline">{{ c.name }}</NuxtLink>
            </li>
          </ul>
        </div>
        <div>
          <p>{{ t('footer.powered') }} <a href="https://prayer.tools" class="underline">Prayer.Tools</a></p>
          <p class="mt-2"><a :href="site.donateUrl" class="underline font-medium">{{ t('footer.give') }}</a></p>
          <p class="mt-2 flex gap-4"><a :href="site.privacyUrl" class="underline">{{ t('footer.privacy') }}</a><a :href="site.termsUrl" class="underline">{{ t('footer.terms') }}</a></p>
        </div>
      </div>
    </footer>
    <ClientOnly>
      <FeedbackWidget v-if="showFeedback" />
    </ClientOnly>
  </div>
</template>
