<script setup lang="ts">
// Toolbar button for text color or highlight: a popover of swatches and a
// button to clear the color. Swatches show as the content does in the current
// theme.
import type { Editor } from '@tiptap/vue-3'
import { PT_HIGHLIGHT_COLORS, PT_TEXT_COLORS } from '../utils/pt-colors'

const props = defineProps<{
  editor: Editor
  kind: 'text' | 'highlight'
}>()

const open = ref(false)
const text = computed(() => props.kind === 'text')
const swatches = computed(() => (text.value ? PT_TEXT_COLORS : PT_HIGHLIGHT_COLORS))
const label = computed(() => (text.value ? 'Text color' : 'Highlight'))
const active = computed(() => (text.value ? !!props.editor.getAttributes('textStyle').color : props.editor.isActive('highlight')))
const current = computed<string | null>(() => (text.value ? props.editor.getAttributes('textStyle').color : props.editor.getAttributes('highlight').color) ?? null)

function pick(color: string | null) {
  const chain = props.editor.chain().focus()
  if (text.value) (color ? chain.setColor(color) : chain.unsetColor()).run()
  else (color ? chain.setHighlight({ color }) : chain.unsetHighlight()).run()
  open.value = false
}
</script>

<template>
  <UPopover
    v-model:open="open"
    :portal="false"
  >
    <UTooltip :text="label">
      <UButton
        :icon="text ? 'i-lucide-baseline' : 'i-lucide-highlighter'"
        color="neutral"
        variant="ghost"
        active-color="primary"
        active-variant="soft"
        size="sm"
        :active="active"
        :aria-label="label"
      />
    </UTooltip>
    <template #content>
      <div class="p-2 space-y-2">
        <div class="grid grid-cols-4 gap-1.5">
          <button
            v-for="s in swatches"
            :key="s.value"
            type="button"
            class="size-8 rounded-md border border-(--ui-border) flex items-center justify-center font-semibold"
            :class="[text ? 'pt-color' : 'pt-mark', current?.toLowerCase() === s.value ? 'ring-2 ring-(--ui-primary)' : '']"
            :style="text ? { '--pt-color': s.value } : { '--pt-mark': s.value }"
            :title="s.label"
            :aria-label="s.label"
            @click="pick(s.value)"
          >
            A
          </button>
        </div>
        <UButton
          :label="text ? 'Default color' : 'No highlight'"
          icon="i-lucide-ban"
          color="neutral"
          variant="ghost"
          size="xs"
          block
          :disabled="!active"
          @click="pick(null)"
        />
      </div>
    </template>
  </UPopover>
</template>
