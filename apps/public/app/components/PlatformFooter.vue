<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <footer class="border-t border-stone-200 bg-white text-sm text-stone-600">
    <div class="max-w-4xl mx-auto px-4 py-6 flex flex-wrap gap-x-6 gap-y-2">
      <span class="me-auto">Prayer.Tools</span>
      <a href="/privacy" class="underline">{{ t('footer.privacy') }}</a>
      <a href="/terms" class="underline">{{ t('footer.terms') }}</a>
    </div>
  </footer>
</template>
