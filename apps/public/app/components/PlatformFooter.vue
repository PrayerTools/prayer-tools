<script setup lang="ts">
defineProps<{ donateUrl: string }>()
const { t } = useI18n()
</script>

<template>
  <footer class="mx-6 border-t border-[#e8ded5] py-8 text-sm">
    <nav aria-label="Footer" class="flex flex-wrap justify-center gap-x-6 gap-y-3 text-stone-700">
      <a :href="donateUrl" class="hover:underline underline-offset-4">{{ t('footer.give') }}</a>
      <a href="/privacy" class="hover:underline underline-offset-4">{{ t('footer.privacy') }}</a>
      <a href="/terms" class="hover:underline underline-offset-4">{{ t('footer.terms') }}</a>
    </nav>
  </footer>
</template>
