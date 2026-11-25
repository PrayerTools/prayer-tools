<script setup lang="ts">
// Store links and a QR code that opens this site in the app (or its page).
defineProps<{ centered?: boolean }>()
const { site, st } = useSite()
const { t } = useI18n()
const qrSrc = '/api/qr.svg'
</script>

<template>
  <div class="flex flex-wrap items-center gap-6" :class="centered && 'justify-center'">
    <div class="space-y-2">
      <p class="text-stone-700">{{ st('landing.app.body') }}</p>
      <div class="flex flex-wrap gap-2" :class="centered && 'justify-center'">
        <UButton v-if="site.appStoreUrl" :to="site.appStoreUrl" target="_blank" color="neutral" icon="i-lucide-apple" :label="t('app.app_store')" />
        <UButton v-if="site.playStoreUrl" :to="site.playStoreUrl" target="_blank" color="neutral" icon="i-lucide-play" :label="t('app.play_store')" />
      </div>
    </div>
    <figure class="m-0 hidden sm:block">
      <img :src="qrSrc" :alt="t('app.qr_alt')" width="128" height="128" class="rounded bg-white p-1" loading="lazy">
      <figcaption class="text-xs text-stone-500 mt-1 max-w-32">{{ t('app.qr_caption') }}</figcaption>
    </figure>
  </div>
</template>
