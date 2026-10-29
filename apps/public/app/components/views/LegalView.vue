<script setup lang="ts">
const props = defineProps<{ doc: 'privacy' | 'terms' }>()
useHead({ title: () => `${props.doc === 'privacy' ? 'Privacy Policy' : 'Terms of Service'} · Prayer.Tools` })
</script>

<template>
  <div class="min-h-dvh flex flex-col">
    <header class="bg-[#2f6f5e] text-white">
      <div class="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
        <a href="/" class="font-bold text-lg me-auto">Prayer.Tools</a>
        <a href="/privacy" class="hover:underline" :aria-current="doc === 'privacy' ? 'page' : undefined">Privacy</a>
        <a href="/terms" class="hover:underline" :aria-current="doc === 'terms' ? 'page' : undefined">Terms</a>
      </div>
    </header>
    <main id="main" class="flex-1 max-w-3xl w-full mx-auto px-4 py-10 text-stone-800 leading-relaxed space-y-4 [&_h1]:text-3xl [&_h1]:font-bold [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:pt-6 [&_h3]:font-semibold [&_h3]:pt-2 [&_ul]:list-disc [&_ul]:ps-6 [&_ul]:space-y-1 [&_a]:underline">
      <LegalPrivacyPolicy v-if="doc === 'privacy'" />
      <LegalTermsOfService v-else />
    </main>
    <PlatformFooter />
  </div>
</template>
