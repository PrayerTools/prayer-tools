<script setup lang="ts">
const mode = useColorMode()
const { t } = useI18n()
const dark = computed(() => mode.value === 'dark')
</script>

<template>
  <ClientOnly>
    <UButton color="neutral" variant="ghost" :icon="dark ? 'i-lucide-sun' : 'i-lucide-moon'" :aria-label="t(dark ? 'theme.light' : 'theme.dark')" :title="t(dark ? 'theme.light' : 'theme.dark')" class="theme-toggle" @click="mode.preference = dark ? 'light' : 'dark'" />
    <template #fallback><span class="inline-block size-8" aria-hidden="true" /></template>
  </ClientOnly>
</template>

<style scoped>
.theme-toggle {
  color: inherit;
  background: transparent;
  border: 1px solid currentColor;
  border-color: color-mix(in srgb, currentColor 30%, transparent);
  border-radius: 0.5rem;
}
.theme-toggle:hover,
.theme-toggle:active {
  color: inherit;
  background: color-mix(in srgb, currentColor 12%, transparent);
}
.theme-toggle:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 3px;
}
</style>
