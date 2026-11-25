<script setup lang="ts">
// A landing section's centered heading, with an optional line under it and a brand-colored bar.
defineProps<{ title: string, titleId: string, subtitle?: string }>()
</script>

<template>
  <div v-reveal:items class="mb-6 text-center">
    <h2 :id="titleId" class="text-2xl sm:text-3xl font-bold text-balance">{{ title }}</h2>
    <p v-if="subtitle" class="mt-1 text-sm text-stone-600">{{ subtitle }}</p>
    <span class="mx-auto mt-3 block h-1 w-12 rounded-full bg-primary" aria-hidden="true" data-reveal-grow />
  </div>
</template>
