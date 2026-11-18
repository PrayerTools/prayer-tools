<script setup lang="ts">
// Toolbar button for links: a popover with the address of the link under the
// cursor (or an empty box for a new one), Apply and Remove. With an image
// selected it sets where clicking the image goes.
import type { Editor } from '@tiptap/vue-3'

const props = defineProps<{
  editor: Editor
}>()

const open = ref(false)
const url = ref('')

const image = computed(() => props.editor.isActive('image'))
const current = computed<string>(() => (image.value ? props.editor.getAttributes('image').href : props.editor.getAttributes('link').href) ?? '')
const label = computed(() => (image.value ? 'Image link' : 'Link'))

watch(open, (isOpen) => {
  if (isOpen) url.value = current.value
})

// A bare domain gets https://; paths and other schemes are kept.
function normalize(raw: string): string {
  const value = raw.trim()
  if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('/') || value.startsWith('#')) return value
  return `https://${value}`
}

function apply() {
  const href = normalize(url.value)
  if (!href) return remove()
  const chain = props.editor.chain().focus()
  if (image.value) chain.updateAttributes('image', { href }).run()
  else if (props.editor.state.selection.empty && !props.editor.isActive('link')) chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run()
  else chain.extendMarkRange('link').setLink({ href }).run()
  open.value = false
}

function remove() {
  const chain = props.editor.chain().focus()
  if (image.value) chain.updateAttributes('image', { href: null }).run()
  else chain.extendMarkRange('link').unsetLink().run()
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
        icon="i-lucide-link"
        color="neutral"
        variant="ghost"
        active-color="primary"
        active-variant="soft"
        size="sm"
        :active="!!current"
        :aria-label="label"
      />
    </UTooltip>
    <template #content>
      <form
        class="flex items-center gap-1 p-1.5"
        @submit.prevent="apply"
      >
        <UInput
          v-model="url"
          :placeholder="image ? 'Where clicking the image goes' : 'Paste a link'"
          size="sm"
          class="w-64"
          autofocus
        />
        <UButton
          type="submit"
          icon="i-lucide-check"
          size="sm"
          aria-label="Apply link"
        />
        <UButton
          v-if="current"
          icon="i-lucide-unlink"
          color="neutral"
          variant="ghost"
          size="sm"
          aria-label="Remove link"
          @click="remove"
        />
      </form>
    </template>
  </UPopover>
</template>
