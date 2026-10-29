<script setup lang="ts">
defineProps<{ adminUrl: string }>()
const { t } = useI18n()
useHead({ title: () => `Prayer.Tools · ${t('home.title')}` })

const features = [
  { icon: 'i-lucide-clock', key: 'coverage' },
  { icon: 'i-lucide-book-open', key: 'content' },
  { icon: 'i-lucide-bell', key: 'reminders' }
] as const
</script>

<template>
  <div class="min-h-dvh flex flex-col">
    <header class="bg-[#2f6f5e] text-white">
      <div class="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
        <a href="/" class="font-bold text-lg me-auto">Prayer.Tools</a>
        <a href="/my" class="hover:underline">{{ t('my.title') }}</a>
        <UButton :to="adminUrl" external variant="ghost" color="neutral" class="text-white hover:bg-white/10" icon="i-lucide-log-in" :label="t('home.sign_in')" />
      </div>
    </header>
    <main id="main" class="flex-1 max-w-4xl w-full mx-auto px-4 py-16 space-y-16">
      <section class="space-y-6 text-center" aria-labelledby="home-title">
        <h1 id="home-title" class="text-4xl sm:text-5xl font-bold text-balance">{{ t('home.title') }}</h1>
        <p class="text-lg text-stone-700 max-w-2xl mx-auto text-pretty">{{ t('home.intro') }}</p>
        <div class="flex flex-wrap justify-center gap-3">
          <UButton :to="`${adminUrl}/orgs/new`" external size="xl" icon="i-lucide-plus" :label="t('home.start')" />
          <UButton to="/my" external size="xl" color="neutral" variant="outline" icon="i-lucide-heart-handshake" :label="t('my.title')" />
        </div>
      </section>
      <section class="grid gap-6 sm:grid-cols-3" :aria-label="t('home.features')">
        <div v-for="f in features" :key="f.key" class="rounded-lg border border-stone-200 bg-white p-6 space-y-2">
          <UIcon :name="f.icon" class="size-6 text-[#2f6f5e]" aria-hidden="true" />
          <h2 class="font-semibold text-lg">{{ t(`home.${f.key}_title`) }}</h2>
          <p class="text-stone-700">{{ t(`home.${f.key}_body`) }}</p>
        </div>
      </section>
    </main>
    <PlatformFooter />
  </div>
</template>
