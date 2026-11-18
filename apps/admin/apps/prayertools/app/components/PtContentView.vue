<script setup lang="ts">
// Read-only rendering of Tiptap content with the shared renderer (the same
// HTML the public site shows).
import { tiptapToHtml } from '@prayertools/shared/tiptap'

const props = defineProps<{ doc: Record<string, any> | null, vars?: Record<string, string> }>()
const html = computed(() => tiptapToHtml(props.doc as never, { mode: 'web', vars: props.vars }))
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- output of the shared renderer, which escapes all text -->
  <div
    class="pt-content prose prose-sm max-w-none dark:prose-invert"
    v-html="html"
  />
</template>

<style>
.pt-content blockquote.verse { border-inline-start: 4px solid var(--ui-border-accented); background: var(--ui-bg-elevated); padding: .5rem 1rem; border-radius: .25rem; }
.pt-content .verse-ref { display: block; font-size: .8rem; color: var(--ui-text-muted); font-style: normal; margin-top: .25rem; }
.pt-content h2 { font-size: 1.25rem; font-weight: 600; margin: 1rem 0 .5rem; }
.pt-content h3 { font-size: 1.1rem; font-weight: 600; margin: .75rem 0 .5rem; }
.pt-content p { margin: .5rem 0; }
.pt-content ul { list-style: disc; padding-inline-start: 1.5rem; }
.pt-content ol { list-style: decimal; padding-inline-start: 1.5rem; }
.pt-content img { max-width: 100%; border-radius: .375rem; }
.pt-content :is(sup, sub) { line-height: 0; }
.pt-content .table-scroll { overflow-x: auto; margin: .75rem 0; }
.pt-content table { width: 100%; border-collapse: collapse; }
.pt-content :is(th, td) { padding: .25rem .5rem; border: 1px solid var(--ui-border-accented); vertical-align: top; text-align: start; }
.pt-content th { background: var(--ui-bg-elevated); font-weight: 600; }
.pt-content :is(th, td) > p { margin: 0; }
.pt-content figure.audio { margin: .75rem 0; }
.pt-content figure.audio figcaption { font-size: .8rem; color: var(--ui-text-muted); }
.pt-content figure.audio audio { width: 100%; }
.pt-content .columns { display: grid; gap: 1rem; margin: .75rem 0; }
@media (min-width: 40rem) { .pt-content .columns { grid-template-columns: var(--pt-columns); } }
.pt-content .column { min-width: 0; }
.pt-content .column > :first-child { margin-top: 0; }
.pt-content .column > :last-child { margin-bottom: 0; }
</style>
