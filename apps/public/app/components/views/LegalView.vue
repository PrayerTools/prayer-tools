<script setup lang="ts">
const props = defineProps<{ doc: 'privacy' | 'terms', donateUrl: string }>()
const themeStyle = usePlatformTheme()
useHead({ title: () => `${props.doc === 'privacy' ? 'Privacy Policy' : 'Terms of Service'} · Prayer.Tools` })
</script>

<template>
  <div class="platform-page min-h-dvh flex flex-col bg-[#fffaf5] text-[#202833] dark:text-slate-100" :style="themeStyle">
    <PlatformHeader>
      <a href="/privacy" class="rounded-lg px-3 py-2 text-sm font-medium text-white/80 no-underline transition-colors hover:bg-white/10 hover:text-white aria-[current=page]:bg-white/10 aria-[current=page]:text-white" :aria-current="doc === 'privacy' ? 'page' : undefined">Privacy</a>
      <a href="/terms" class="rounded-lg px-3 py-2 text-sm font-medium text-white/80 no-underline transition-colors hover:bg-white/10 hover:text-white aria-[current=page]:bg-white/10 aria-[current=page]:text-white" :aria-current="doc === 'terms' ? 'page' : undefined">Terms</a>
    </PlatformHeader>
    <main id="main" class="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-12 sm:py-16 text-stone-800 leading-relaxed space-y-4 [&_h1]:text-3xl sm:[&_h1]:text-4xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:pt-6 [&_h3]:font-semibold [&_h3]:pt-2 [&_ul]:list-disc [&_ul]:ps-6 [&_ul]:space-y-1 [&_a]:underline [&_a]:underline-offset-4">
      <div class="h-1 w-12 rounded-full bg-[#f58220]" aria-hidden="true" />
      <LegalPrivacyPolicy v-if="doc === 'privacy'" />
      <LegalTermsOfService v-else />
    </main>
    <PlatformFooter :donate-url="donateUrl" />
  </div>
</template>
