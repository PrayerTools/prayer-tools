<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'
import type { EditorToolbarItem } from '@nuxt/ui'
import { PtVerse } from '../utils/pt-verse'
import { PtVideo } from '../utils/pt-video'

const props = withDefaults(defineProps<{
  placeholder?: string
  placeholders?: boolean
  dir?: 'ltr' | 'rtl'
  minHeight?: string
  disabled?: boolean
}>(), { placeholder: 'Write here…', placeholders: false, dir: 'ltr', minHeight: '12rem', disabled: false })

const model = defineModel<Record<string, any> | null>({ default: null })

const doc = computed({
  get: () => model.value ?? { type: 'doc', content: [] },
  set: (v) => { model.value = v as Record<string, any> }
})

const verseOpen = ref(false)
const verse = reactive({ reference: '', translation: '', text: '', loading: false, error: '' })
const imageOpen = ref(false)
let activeEditor: Editor | null = null

const PLACEHOLDERS = [
  { label: 'Site name', value: '{site_name}' },
  { label: 'Campaign name', value: '{campaign_name}' },
  { label: 'Place', value: '{place}' },
  { label: 'In the place (e.g. “in Morocco”)', value: '{in_place}' },
  { label: 'Of the place (e.g. “of Morocco”)', value: '{of_place}' },
  { label: 'People group', value: '{people_group}' },
  { label: 'Start date', value: '{start_date}' },
  { label: 'End date', value: '{end_date}' }
]

const handlers = {
  ptVerse: {
    canExecute: () => true,
    execute: (editor: Editor) => {
      activeEditor = editor
      verse.reference = ''
      verse.text = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' ')
      verse.error = ''
      verseOpen.value = true
      return editor.chain()
    },
    isActive: (editor: Editor) => editor.isActive('verse'),
    isDisabled: () => false
  },
  ptImage: {
    canExecute: () => true,
    execute: (editor: Editor) => {
      activeEditor = editor
      imageOpen.value = true
      return editor.chain()
    },
    isActive: () => false,
    isDisabled: () => false
  }
}

const items = computed<EditorToolbarItem[][]>(() => {
  const groups: EditorToolbarItem[][] = [
    [
      { kind: 'undo', icon: 'i-lucide-undo', 'aria-label': 'Undo' },
      { kind: 'redo', icon: 'i-lucide-redo', 'aria-label': 'Redo' }
    ],
    [
      {
        icon: 'i-lucide-heading',
        'aria-label': 'Text style',
        content: { align: 'start' },
        items: [
          { kind: 'paragraph', label: 'Paragraph', icon: 'i-lucide-type' },
          { kind: 'heading', level: 2, label: 'Heading', icon: 'i-lucide-heading-2' },
          { kind: 'heading', level: 3, label: 'Subheading', icon: 'i-lucide-heading-3' }
        ]
      } as EditorToolbarItem,
      { kind: 'mark', mark: 'bold', icon: 'i-lucide-bold', 'aria-label': 'Bold' },
      { kind: 'mark', mark: 'italic', icon: 'i-lucide-italic', 'aria-label': 'Italic' },
      { kind: 'mark', mark: 'underline', icon: 'i-lucide-underline', 'aria-label': 'Underline' },
      { kind: 'link', icon: 'i-lucide-link', 'aria-label': 'Link' }
    ],
    [
      { kind: 'bulletList', icon: 'i-lucide-list', 'aria-label': 'Bullet list' },
      { kind: 'orderedList', icon: 'i-lucide-list-ordered', 'aria-label': 'Numbered list' },
      { kind: 'blockquote', icon: 'i-lucide-text-quote', 'aria-label': 'Quote' },
      { kind: 'ptVerse', icon: 'i-lucide-book-open-text', 'aria-label': 'Scripture', tooltip: { text: 'Scripture' } } as EditorToolbarItem,
      { kind: 'ptImage', icon: 'i-lucide-image', 'aria-label': 'Image', tooltip: { text: 'Image' } } as EditorToolbarItem,
      { kind: 'horizontalRule', icon: 'i-lucide-minus', 'aria-label': 'Divider' }
    ]
  ]
  return groups
})

const { data: blocks } = useFetch<{ blocks: { id: string, name: string, content: { content?: unknown[] } }[] }>('/api/pt/blocks', { key: 'pt-blocks', lazy: true, server: false })

function insertBlock(editor: Editor, content: { content?: unknown[] }) {
  editor.chain().focus().insertContent(content.content ?? []).run()
}

function insertPlaceholder(editor: Editor, value: string) {
  editor.chain().focus().insertContent(value).run()
}

async function lookupVerse() {
  verse.loading = true
  verse.error = ''
  try {
    const res = await $fetch<{ text: string, reference: string, translation: string }>('/api/pt/scripture', { query: { ref: verse.reference, translation: verse.translation || undefined } })
    verse.text = res.text
    verse.reference = res.reference
    verse.translation = res.translation
  } catch (err) {
    verse.error = ptErrorMessage(err)
  } finally {
    verse.loading = false
  }
}

function insertVerse() {
  if (!activeEditor || !verse.text.trim()) return
  const paragraphs = verse.text.split(/\n{2,}/).map(t => ({ type: 'paragraph', content: [{ type: 'text', text: t.trim() }] }))
  activeEditor.chain().focus().insertContent({ type: 'verse', attrs: { reference: verse.reference || null, translation: verse.translation || null }, content: paragraphs }).run()
  verseOpen.value = false
}

function insertImage(asset: { url: string, alt: string }) {
  activeEditor?.chain().focus().setImage({ src: asset.url, alt: asset.alt }).run()
  imageOpen.value = false
}
</script>

<template>
  <div
    class="rounded-md border border-(--ui-border) bg-(--ui-bg)"
    :class="disabled ? 'opacity-70 pointer-events-none' : ''"
  >
    <UEditor
      v-slot="{ editor }"
      v-model="doc"
      content-type="json"
      :extensions="[PtVerse, PtVideo]"
      :handlers="handlers"
      :placeholder="placeholder"
      :editable="!disabled"
      :text-direction="dir"
      :ui="{ base: 'px-4 py-3 prose-sm max-w-none focus:outline-none' }"
      :style="{ minHeight }"
    >
      <div class="flex flex-wrap items-center gap-1 border-b border-(--ui-border) px-2 py-1 sticky top-0 bg-(--ui-bg) z-10">
        <UEditorToolbar
          :editor="editor"
          :items="items"
        />
        <UDropdownMenu
          v-if="blocks?.blocks.length"
          :items="blocks.blocks.map(b => ({ label: b.name, onSelect: () => insertBlock(editor, b.content) }))"
        >
          <UButton
            icon="i-lucide-blocks"
            color="neutral"
            variant="ghost"
            size="sm"
            label="Blocks"
            aria-label="Insert one of your reusable blocks"
          />
        </UDropdownMenu>
        <UDropdownMenu
          v-if="placeholders"
          :items="PLACEHOLDERS.map(p => ({ label: `${p.label} ${p.value}`, onSelect: () => insertPlaceholder(editor, p.value) }))"
        >
          <UButton
            icon="i-lucide-braces"
            color="neutral"
            variant="ghost"
            size="sm"
            label="Insert"
            aria-label="Insert a placeholder"
          />
        </UDropdownMenu>
      </div>
    </UEditor>

    <UModal
      v-model:open="verseOpen"
      title="Add Scripture"
      description="Look up a verse, or paste its text. Scripture is never translated by AI."
    >
      <template #body>
        <div class="space-y-3">
          <div class="flex gap-2">
            <UFormField
              label="Reference"
              class="flex-1"
            >
              <UInput
                v-model="verse.reference"
                placeholder="John 3:16-17"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Translation">
              <UInput
                v-model="verse.translation"
                placeholder="NIV"
                class="w-24"
              />
            </UFormField>
          </div>
          <UButton
            label="Look up"
            icon="i-lucide-search"
            variant="soft"
            :loading="verse.loading"
            :disabled="!verse.reference.trim()"
            @click="lookupVerse"
          />
          <UAlert
            v-if="verse.error"
            color="warning"
            variant="soft"
            :description="verse.error"
          />
          <UFormField label="Verse text">
            <UTextarea
              v-model="verse.text"
              :rows="5"
              autoresize
              class="w-full"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="verseOpen = false"
          />
          <UButton
            label="Insert"
            :disabled="!verse.text.trim()"
            @click="insertVerse"
          />
        </div>
      </template>
    </UModal>

    <PtImagePicker
      v-model:open="imageOpen"
      @select="insertImage"
    />
  </div>
</template>

<style>
.pt-verse {
  border-inline-start: 4px solid var(--ui-border-accented);
  background: var(--ui-bg-elevated);
  padding: 0.5rem 1rem;
  border-radius: 0.25rem;
}
.pt-verse[data-reference]::after {
  content: attr(data-reference);
  display: block;
  font-size: 0.8rem;
  color: var(--ui-text-muted);
  margin-top: 0.25rem;
}
</style>
