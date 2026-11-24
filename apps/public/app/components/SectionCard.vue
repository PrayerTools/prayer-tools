<script setup lang="ts">
// A titled white card: header with the title and optional actions, body, optional footer.
// `centered` centers the title and the body's text.
withDefaults(defineProps<{ title: string, titleId: string, level?: 2 | 3, muted?: boolean, centered?: boolean }>(), { level: 2 })
</script>

<template>
  <section :aria-labelledby="titleId" class="rounded-xl border border-stone-200 bg-white shadow-[0_1px_3px_rgb(28_25_23/0.05)]">
    <header class="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 border-b border-stone-200 px-5 py-3" :class="centered && 'justify-center text-center'">
      <component :is="`h${level}`" :id="titleId" class="text-base font-semibold tracking-tight" :class="muted && 'text-stone-600'">{{ title }}</component>
      <slot name="badge" />
      <div v-if="$slots.actions" class="ms-auto flex items-center gap-1">
        <slot name="actions" />
      </div>
    </header>
    <div class="px-5" :class="centered && 'text-center'">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="border-t border-stone-200 px-5 py-3">
      <slot name="footer" />
    </footer>
  </section>
</template>
