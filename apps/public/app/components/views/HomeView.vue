<script setup lang="ts">
import ThemeToggle from '../ThemeToggle.vue'
import { brandColor, brandForeground } from '@prayertools/shared/colors'
defineProps<{ adminUrl: string }>()
const { t } = useI18n()
const mode = useColorMode()
const homeColor = '#c45100'
const themeStyle = computed(() => ({
  '--ui-text-inverted': brandColor(homeColor).textColor,
  '--ui-primary': brandForeground(homeColor, mode.value === 'dark' ? '#202c3a' : '#ffffff')
}))
useHead({ title: () => `Prayer.Tools · ${t('home.title')}` })

const features = [
  { icon: 'i-lucide-clock', key: 'coverage' },
  { icon: 'i-lucide-book-open', key: 'content' },
  { icon: 'i-lucide-bell', key: 'reminders' }
] as const
</script>

<template>
  <div class="home-page min-h-dvh flex flex-col bg-[#fffaf5] text-[#202833] dark:text-slate-100" :style="themeStyle">
    <header class="home-header bg-[#202833] text-white">
      <div class="max-w-4xl mx-auto px-4 sm:px-6 py-6 flex items-center gap-3 sm:gap-6">
        <a href="/" class="relative block h-[38px] w-[120px] shrink-0 me-auto" aria-label="Prayer.Tools home">
          <img src="/prayer-tools-logo.png" alt="" width="120" height="38" class="absolute inset-0 h-full w-full [clip-path:inset(0_69%_0_0)]" />
          <img src="/prayer-tools-logo.png" alt="" width="120" height="38" class="absolute inset-0 h-full w-full [clip-path:inset(0_0_0_31%)] brightness-0 invert" />
        </a>
        <ThemeToggle />
        <a href="/my" class="rounded-lg px-3 py-2 text-sm font-medium text-white/80 no-underline transition-colors hover:bg-white/10 hover:text-white">{{ t('my.title') }}</a>
        <UButton :to="adminUrl" external variant="ghost" color="neutral" class="rounded-full border border-white/30 px-5 py-2 text-sm font-medium text-white no-underline transition-colors hover:no-underline hover:bg-white/10" icon="i-lucide-log-in" :label="t('home.sign_in')" />
      </div>
    </header>
    <main id="main" class="flex-1 max-w-4xl w-full mx-auto px-4 py-16 space-y-16">
      <section class="space-y-6 text-center" aria-labelledby="home-title">
        <h1 id="home-title" class="text-4xl sm:text-5xl font-bold text-balance">{{ t('home.title') }}</h1>
        <p class="text-lg text-stone-700 max-w-2xl mx-auto text-pretty">{{ t('home.intro') }}</p>
        <div class="flex flex-wrap justify-center gap-3">
          <UButton :to="`${adminUrl}/orgs/new`" external size="xl" icon="i-lucide-plus" class="home-start-button" :label="t('home.start')" />
          <UButton to="/my" external size="xl" color="neutral" variant="outline" icon="i-lucide-heart-handshake" :label="t('my.title')" />
        </div>
      </section>
      <section class="grid gap-6 sm:grid-cols-3" :aria-label="t('home.features')">
        <div v-for="f in features" :key="f.key" class="rounded-lg border border-stone-200 bg-white p-6 space-y-2">
          <UIcon :name="f.icon" class="size-6 text-(--ui-primary)" aria-hidden="true" />
          <h2 class="font-semibold text-lg">{{ t(`home.${f.key}_title`) }}</h2>
          <p class="text-stone-700">{{ t(`home.${f.key}_body`) }}</p>
        </div>
      </section>
    </main>
    <PlatformFooter />
  </div>
</template>

<style scoped>
.home-start-button { background: #c45100; color: #ffffff; }
.home-start-button:hover, .home-start-button:active { background: #a94300; color: #ffffff; }
</style>
