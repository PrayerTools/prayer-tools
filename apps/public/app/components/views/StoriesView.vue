<script setup lang="ts">
const { site, st } = useSite()
const { t } = useI18n()
useHead({ title: () => `${st('landing.stories.title')} · ${site.value.name}` })
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-10 space-y-6">
    <h1 class="text-3xl font-bold">{{ t('stories.title') }}</h1>
    <p class="text-stone-700">{{ t('stories.intro', { site: site.name }) }}</p>
    <StoryForm />
  </div>
</template>
