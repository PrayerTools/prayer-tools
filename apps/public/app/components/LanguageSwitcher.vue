<script setup lang="ts">
const { site } = useSite()
const { t } = useI18n()
const route = useRoute()

// Same page in another language: swap the language segment of the path.
function pathFor(code: string): string {
  const segs = route.path.split('/').filter(Boolean)
  if (segs[0] && site.value.languages.some(l => l.code === segs[0])) segs.shift()
  if (code !== site.value.defaultLanguage) segs.unshift(code)
  return `/${segs.join('/')}`
}

const items = computed(() => site.value.languages.map(l => ({
  label: l.native,
  to: pathFor(l.code),
  lang: l.code,
  active: l.code === site.value.lang,
  onSelect: () => trackEvent('language_switched', { from: site.value.lang, to: l.code })
})))
</script>

<template>
  <UDropdownMenu v-if="site.languages.length > 1" :items="items">
    <UButton
      color="neutral"
      variant="ghost"
      icon="i-lucide-languages"
      :aria-label="t('nav.language')"
      :title="site.languages.find(l => l.code === site.lang)?.native"
      class="text-(--brand-text) hover:bg-white/10"
    />
  </UDropdownMenu>
</template>
