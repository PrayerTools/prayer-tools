<script setup lang="ts">
// A landing section that is switched on but has nothing to show yet. Only
// the admin editor's preview shows it, so the hint is in English like the admin.
// `customId` names the custom section it stands for.
const props = defineProps<{ section: string, title: string, customId?: string }>()

const HINTS: Record<string, string> = {
  goal: 'The campaign\'s dates, progress and calendar show here once it has a start date.',
  why: 'Nothing written yet. Write why people should pray, or hide this section.',
  about: 'Nothing written yet. Tell visitors more about what this campaign prays for, or hide this section.',
  custom: 'Nothing to show yet. Give this section a heading, text or a video, or hide it.',
  stories: 'No published stories yet. Once you publish stories from the Stories page they show like the examples below.',
  today: 'Today\'s prayer shows here once the campaign has prayer content for today.',
  app: 'Links to the Prayer.Tools app show here once the app is available.'
}

const EXAMPLE_STORIES = [
  { body: 'I set a reminder for my lunch break and prayed every day of the campaign. Reading the prayer guide helped me pray for people I had never thought about before.', name: 'Grace' },
  { body: 'Our small group took the early morning slot together. Knowing others were praying through the night kept us going.', name: null }
]
</script>

<template>
  <section :data-pt-section="props.customId ? undefined : props.section" :data-pt-custom="props.customId" class="rounded-xl border-2 border-dashed border-stone-300 bg-stone-100/60 p-6 text-stone-500" dir="ltr">
    <h2 class="text-2xl font-bold text-stone-400">{{ props.title }}</h2>
    <p class="mt-2 text-sm">{{ HINTS[props.section] }}</p>
    <div v-if="props.section === 'stories'" class="mt-4 grid gap-4 sm:grid-cols-2 opacity-70">
      <figure v-for="(s, i) in EXAMPLE_STORIES" :key="i" class="m-0 rounded-xl bg-white border border-stone-200 p-5">
        <span class="mb-2 inline-block rounded bg-stone-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-600">Example</span>
        <blockquote class="whitespace-pre-line text-stone-800">{{ s.body }}</blockquote>
        <figcaption class="mt-3 text-sm text-stone-600">— {{ s.name || 'Anonymous' }}</figcaption>
      </figure>
    </div>
    <p class="mt-3 text-xs uppercase tracking-wide text-stone-400">Only you see this, in the editor</p>
  </section>
</template>
