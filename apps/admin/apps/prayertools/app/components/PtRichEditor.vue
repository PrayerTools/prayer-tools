<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'
import type { Editor as CoreEditor } from '@tiptap/core'
import type { EditorToolbarItem } from '@nuxt/ui'
import { ptContentExtensions } from '../utils/pt-content-extensions'
import { COLUMN_LAYOUTS, columnsAt, columnsContent, isColumnLayout, removeColumns, selectFirstColumn, setColumnLayout } from '../utils/pt-columns'

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
const audioOpen = ref(false)
const audio = reactive({ src: '', title: '', editing: false, uploading: false })
const audioInput = ref<HTMLInputElement>()
const audioFormId = useId()
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

const TABLE_COMMANDS = ['addRowBefore', 'addRowAfter', 'toggleHeaderRow', 'deleteRow', 'addColumnBefore', 'addColumnAfter', 'deleteColumn', 'mergeCells', 'splitCell', 'deleteTable'] as const

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
  },
  ptAudio: {
    canExecute: () => true,
    execute: (editor: Editor) => {
      activeEditor = editor
      const current = editor.isActive('audio') ? editor.getAttributes('audio') : null
      audio.src = current?.src ?? ''
      audio.title = current?.title ?? ''
      audio.editing = !!current
      audioOpen.value = true
      return editor.chain()
    },
    isActive: (editor: Editor) => editor.isActive('audio'),
    isDisabled: () => false
  },
  ptTable: {
    canExecute: (editor: Editor) => editor.can().insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
    execute: (editor: Editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
    isActive: (editor: Editor) => editor.isActive('table'),
    isDisabled: (editor: Editor) => editor.isActive('table')
  },
  ...Object.fromEntries([2, 3].map(count => [`ptColumns${count}`, {
    canExecute: () => true,
    execute: (editor: Editor) => editor.chain().focus().insertContent(columnsContent(count)).command(({ tr }) => selectFirstColumn(tr)),
    isActive: () => false,
    isDisabled: (editor: Editor) => editor.isActive('columns')
  }])),
  ...Object.fromEntries(COLUMN_LAYOUTS.map((layout, i) => [`ptColumnLayout${i}`, {
    canExecute: (editor: Editor) => editor.isActive('columns'),
    execute: (editor: Editor) => editor.chain().focus().command(({ tr }) => setColumnLayout(tr, layout)),
    isActive: (editor: Editor) => {
      const found = columnsAt(editor.state)
      return !!found && isColumnLayout(found.node, layout)
    }
  }])),
  ptColumnsRemove: {
    canExecute: (editor: Editor) => editor.isActive('columns'),
    execute: (editor: Editor) => editor.chain().focus().command(({ tr }) => removeColumns(tr)),
    isActive: () => false
  },
  ...Object.fromEntries(TABLE_COMMANDS.map(name => [name, {
    canExecute: (editor: Editor) => editor.can()[name](),
    execute: (editor: Editor) => editor.chain().focus()[name](),
    isActive: () => false
  }]))
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
      { 'kind': 'mark', 'mark': 'superscript', 'icon': 'i-lucide-superscript', 'aria-label': 'Superscript', 'tooltip': { text: 'Superscript' } } as unknown as EditorToolbarItem,
      { 'kind': 'mark', 'mark': 'subscript', 'icon': 'i-lucide-subscript', 'aria-label': 'Subscript', 'tooltip': { text: 'Subscript' } } as unknown as EditorToolbarItem,
      { slot: 'textColor' } as EditorToolbarItem,
      { slot: 'highlight' } as EditorToolbarItem,
      { slot: 'link' } as EditorToolbarItem
    ],
    [
      { kind: 'bulletList', icon: 'i-lucide-list', 'aria-label': 'Bullet list' },
      { kind: 'orderedList', icon: 'i-lucide-list-ordered', 'aria-label': 'Numbered list' },
      { kind: 'blockquote', icon: 'i-lucide-text-quote', 'aria-label': 'Quote' },
      { kind: 'ptVerse', icon: 'i-lucide-book-open-text', 'aria-label': 'Scripture', tooltip: { text: 'Scripture' } } as EditorToolbarItem,
      { kind: 'ptImage', icon: 'i-lucide-image', 'aria-label': 'Image', tooltip: { text: 'Image' } } as EditorToolbarItem,
      { 'kind': 'ptAudio', 'icon': 'i-lucide-audio-lines', 'aria-label': 'Audio', 'tooltip': { text: 'Audio' } } as EditorToolbarItem,
      { 'kind': 'ptTable', 'icon': 'i-lucide-table', 'aria-label': 'Table', 'tooltip': { text: 'Table' } } as EditorToolbarItem,
      {
        'icon': 'i-lucide-columns-2',
        'aria-label': 'Columns',
        'tooltip': { text: 'Columns' },
        'content': { align: 'start' },
        'items': [
          { kind: 'ptColumns2', label: 'Two columns', icon: 'i-lucide-columns-2' },
          { kind: 'ptColumns3', label: 'Three columns', icon: 'i-lucide-columns-3' }
        ]
      } as EditorToolbarItem,
      { kind: 'horizontalRule', icon: 'i-lucide-minus', 'aria-label': 'Divider' }
    ]
  ]
  return groups
})

// Shown above a table while the cursor is in it.
const tableItems = [
  [
    {
      'icon': 'i-lucide-between-horizontal-start',
      'aria-label': 'Table rows',
      'tooltip': { text: 'Rows' },
      'content': { align: 'start' },
      'items': [
        [
          { kind: 'addRowBefore', label: 'Add row above', icon: 'i-lucide-arrow-up-to-line' },
          { kind: 'addRowAfter', label: 'Add row below', icon: 'i-lucide-arrow-down-to-line' },
          { kind: 'toggleHeaderRow', label: 'Header row', icon: 'i-lucide-panel-top' }
        ],
        [{ kind: 'deleteRow', label: 'Delete row', icon: 'i-lucide-trash-2', color: 'error' }]
      ]
    },
    {
      'icon': 'i-lucide-between-vertical-start',
      'aria-label': 'Table columns',
      'tooltip': { text: 'Columns' },
      'content': { align: 'start' },
      'items': [
        [
          { kind: 'addColumnBefore', label: 'Add column before', icon: 'i-lucide-arrow-left-to-line' },
          { kind: 'addColumnAfter', label: 'Add column after', icon: 'i-lucide-arrow-right-to-line' }
        ],
        [{ kind: 'deleteColumn', label: 'Delete column', icon: 'i-lucide-trash-2', color: 'error' }]
      ]
    }
  ],
  [
    { 'kind': 'mergeCells', 'icon': 'i-lucide-table-cells-merge', 'aria-label': 'Merge cells', 'tooltip': { text: 'Merge cells' } },
    { 'kind': 'splitCell', 'icon': 'i-lucide-table-cells-split', 'aria-label': 'Split cell', 'tooltip': { text: 'Split cell' } }
  ],
  [{ 'kind': 'deleteTable', 'icon': 'i-lucide-trash-2', 'aria-label': 'Delete table', 'tooltip': { text: 'Delete table' } }]
] as EditorToolbarItem[][]

// Shown above columns while the cursor is in them.
const columnItems = [
  COLUMN_LAYOUTS.map((layout, i) => ({ 'kind': `ptColumnLayout${i}`, 'icon': layout.icon, 'aria-label': layout.label, 'tooltip': { text: layout.label } })),
  [{ 'kind': 'ptColumnsRemove', 'icon': 'i-lucide-ungroup', 'aria-label': 'Remove columns', 'tooltip': { text: 'Remove columns, keeping their content' } }]
] as EditorToolbarItem[][]

const inTable = ({ editor }: { editor: CoreEditor }) => editor.isEditable && editor.isActive('table')
const inColumns = ({ editor }: { editor: CoreEditor }) => editor.isEditable && editor.isActive('columns') && !editor.isActive('table')

// Anchors a bubble toolbar to the enclosing node of `type`, so it sits above
// the table or columns instead of over the text being typed.
function blockAnchor(editor: Editor, type: string) {
  const { $from } = editor.state.selection
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name !== type) continue
    const dom = editor.view.nodeDOM($from.before(d))
    if (dom instanceof HTMLElement) return { getBoundingClientRect: () => dom.getBoundingClientRect(), getClientRects: () => dom.getClientRects() }
  }
  return null
}

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

const toast = usePtToast()

async function uploadAudio(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  audio.uploading = true
  try {
    const form = new FormData()
    form.append('file', file)
    const res = await $fetch<{ url: string }>('/api/pt/audio', { method: 'POST', body: form })
    audio.src = res.url
    if (!audio.title.trim()) audio.title = file.name.replace(/\.[^.]+$/, '')
  } catch (err) {
    toast.fail(err, 'Upload failed')
  } finally {
    audio.uploading = false
  }
}

function saveAudio() {
  const src = audio.src.trim()
  if (!activeEditor || !/^https?:\/\//i.test(src)) return
  const attrs = { src, title: audio.title.trim() || null }
  const chain = activeEditor.chain().focus()
  if (audio.editing) chain.updateAttributes('audio', attrs).run()
  else chain.insertContent({ type: 'audio', attrs }).run()
  audioOpen.value = false
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
      :extensions="ptContentExtensions"
      :handlers="handlers"
      :placeholder="placeholder"
      :editable="!disabled"
      :text-direction="dir"
      :ui="{ base: 'pt-rich-editor px-4 py-3 prose-sm max-w-none focus:outline-none' }"
      :style="{ minHeight }"
    >
      <div class="flex flex-wrap items-center gap-1 border-b border-(--ui-border) px-2 py-1 sticky top-0 bg-(--ui-bg) z-10">
        <UEditorToolbar
          :editor="editor"
          :items="items"
        >
          <template #link>
            <PtLinkPopover :editor="editor" />
          </template>
          <template #textColor>
            <PtColorPopover
              :editor="editor"
              kind="text"
            />
          </template>
          <template #highlight>
            <PtColorPopover
              :editor="editor"
              kind="highlight"
            />
          </template>
        </UEditorToolbar>
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
      <UEditorToolbar
        :editor="editor"
        :items="tableItems"
        layout="bubble"
        plugin-key="ptTableMenu"
        :should-show="inTable"
        :get-referenced-virtual-element="() => blockAnchor(editor, 'table')"
      />
      <UEditorToolbar
        :editor="editor"
        :items="columnItems"
        layout="bubble"
        plugin-key="ptColumnsMenu"
        :should-show="inColumns"
        :get-referenced-virtual-element="() => blockAnchor(editor, 'columns')"
      />
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

    <UModal
      v-model:open="audioOpen"
      :title="audio.editing ? 'Change audio' : 'Add audio'"
    >
      <template #body>
        <form
          :id="audioFormId"
          class="space-y-5"
          @submit.prevent="saveAudio"
        >
          <UFormField>
            <template #label>
              Audio file <InfoTip text="Upload an MP3, M4A, OGG or WAV file of up to 50 MB, or paste the address of one." />
            </template>
            <div class="flex gap-2">
              <UInput
                v-model="audio.src"
                placeholder="https://…"
                class="flex-1"
              />
              <UButton
                label="Upload"
                icon="i-lucide-upload"
                color="neutral"
                variant="outline"
                :loading="audio.uploading"
                @click="audioInput?.click()"
              />
            </div>
          </UFormField>
          <UFormField label="Title">
            <UInput
              v-model="audio.title"
              class="w-full"
            />
          </UFormField>
          <audio
            v-if="/^https?:\/\//i.test(audio.src.trim())"
            :src="audio.src.trim()"
            controls
            preload="none"
            class="w-full"
          />
        </form>
        <input
          ref="audioInput"
          type="file"
          accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg,audio/wav,.mp3,.m4a,.ogg,.wav"
          class="hidden"
          @change="uploadAudio"
        >
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="audioOpen = false"
          />
          <UButton
            type="submit"
            :form="audioFormId"
            :label="audio.editing ? 'Save' : 'Insert'"
            :disabled="!/^https?:\/\//i.test(audio.src.trim()) || audio.uploading"
          />
        </div>
      </template>
    </UModal>
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
