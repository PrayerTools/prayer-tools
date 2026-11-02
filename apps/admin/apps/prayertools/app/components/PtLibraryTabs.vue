<script setup lang="ts">
const items = [
  { label: 'Images and blocks', to: '/personal', icon: 'i-lucide-images', exempt: true },
  { label: 'Email templates', to: '/personal/templates', icon: 'i-lucide-layout-template', exempt: true },
  { label: 'Campaign templates', to: '/personal/campaigns', icon: 'i-lucide-bookmark', exempt: true }
]
</script>

<template>
  <PtSectionTabs :items="items" />
</template>
