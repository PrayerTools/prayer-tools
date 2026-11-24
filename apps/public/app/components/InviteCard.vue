<script setup lang="ts">
// "Invite others to pray": the same card on the landing, prayer, not-started and ended pages.
withDefaults(defineProps<{ titleId?: string, centered?: boolean }>(), { titleId: 'share-title' })
const { st } = useSite()
</script>

<template>
  <SectionCard :title="st('landing.share.title')" :title-id="titleId" :centered="centered">
    <div class="space-y-4 py-5">
      <p class="text-stone-700">{{ st('landing.share.body') }}</p>
      <ShareButton size="md" variant="soft" :class="centered && 'justify-center'" />
    </div>
  </SectionCard>
</template>
