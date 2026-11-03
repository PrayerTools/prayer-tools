<script setup lang="ts">
const { can } = usePtSite()
const items = computed(() => [
  ...(can('pt.setup.read')
    ? [
        { label: 'Landing page', to: '/site/landing', icon: 'i-lucide-panels-top-left' },
        { label: 'Signup form', to: '/site/landing/signup-form', icon: 'i-lucide-list-checks' }
      ]
    : []),
  ...(can('pt.intercessors.read') ? [{ label: 'Stories', to: '/site/landing/stories', icon: 'i-lucide-heart-handshake' }] : []),
  { label: 'Share', to: '/site/landing/share', icon: 'i-lucide-share-2' }
])
</script>

<template>
  <PtSectionTabs :items="items" />
</template>
