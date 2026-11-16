<script setup lang="ts">
import type { Editor, JSONContent } from '@tiptap/vue-3'
import type { EditorToolbarItem } from '@nuxt/ui'
import type { MarketingDoc, MarketingVariable } from '../utils/marketing-ui'
import { getMarketingExtensions, getMarketingInserters, marketingFitContent, type MarketingInsert, type MarketingInsertItem, type MarketingInserter } from '../utils/marketing-inserters'

const props = withDefaults(defineProps<{
  variables?: MarketingVariable[]
  dir?: 'ltr' | 'rtl'
  // The language of the version being edited, passed to inserters' pickers.
  lang?: string
  disabled?: boolean
}>(), { variables: () => [], dir: 'ltr', lang: 'en', disabled: false })

const model = defineModel<MarketingDoc>({ required: true })

// UEditor types its JSON as Tiptap's `Content`; the stored shape is the same document.
const doc = computed({
  get: () => model.value as unknown as JSONContent,
  set: (v) => { model.value = v as unknown as MarketingDoc }
})

const items: EditorToolbarItem[][] = [
  [
    { 'kind': 'undo', 'icon': 'i-lucide-undo', 'aria-label': 'Undo' },
    { 'kind': 'redo', 'icon': 'i-lucide-redo', 'aria-label': 'Redo' }
  ],
  [
    {
      'icon': 'i-lucide-heading',
      'aria-label': 'Text style',
      'content': { align: 'start' },
      'items': [
        { kind: 'paragraph', label: 'Paragraph', icon: 'i-lucide-type' },
        { kind: 'heading', level: 2, label: 'Heading', icon: 'i-lucide-heading-2' },
        { kind: 'heading', level: 3, label: 'Subheading', icon: 'i-lucide-heading-3' }
      ]
    } as EditorToolbarItem,
    { 'kind': 'mark', 'mark': 'bold', 'icon': 'i-lucide-bold', 'aria-label': 'Bold' },
    { 'kind': 'mark', 'mark': 'italic', 'icon': 'i-lucide-italic', 'aria-label': 'Italic' },
    { 'kind': 'mark', 'mark': 'underline', 'icon': 'i-lucide-underline', 'aria-label': 'Underline' },
    { 'kind': 'link', 'icon': 'i-lucide-link', 'aria-label': 'Link' }
  ],
  [
    { 'kind': 'bulletList', 'icon': 'i-lucide-list', 'aria-label': 'Bullet list' },
    { 'kind': 'orderedList', 'icon': 'i-lucide-list-ordered', 'aria-label': 'Numbered list' },
    { 'kind': 'blockquote', 'icon': 'i-lucide-text-quote', 'aria-label': 'Quote' },
    { 'kind': 'horizontalRule', 'icon': 'i-lucide-minus', 'aria-label': 'Divider' }
  ]
]

function insert(editor: Editor, key: string) {
  editor.chain().focus().insertContent(`{${key}}`).run()
}

const toast = useToast()
const inserters = getMarketingInserters()
const extensions = getMarketingExtensions()
const pickerOpen = ref<string | null>(null)
const menuItems = ref<Record<string, MarketingInsertItem[]>>({})
let pickerEditor: Editor | null = null

watch(() => props.disabled, async (disabled) => {
  if (disabled) return
  for (const ins of inserters) {
    if (!ins.items || menuItems.value[ins.id]) continue
    menuItems.value[ins.id] = await ins.items().catch(() => [])
  }
}, { immediate: true })

function openPicker(editor: Editor, ins: MarketingInserter) {
  if (props.disabled) return
  pickerEditor = editor
  pickerOpen.value = ins.id
}

function onPicked(ins: MarketingInserter, picked: unknown) {
  pickerOpen.value = null
  if (pickerEditor && ins.picker) insertContent(pickerEditor, ins.picker.toInsert(picked as never))
}

function insertContent(editor: Editor, insert: MarketingInsert) {
  if (props.disabled) return
  const { schema } = editor
  const { content, changed } = marketingFitContent(
    insert.content,
    (type) => {
      const node = schema.nodes[type]
      return !node ? undefined : node.isInline ? 'inline' : node.isTextblock ? 'textblock' : 'block'
    },
    type => !!schema.marks[type]
  )
  if (!content.length) return
  const inserted = editor.chain().focus()
    .command(({ tr, commands }) => commands.insertContentAt({ from: tr.selection.from, to: tr.selection.to }, content, { errorOnInvalidContent: true }))
    .run()
  if (!inserted) {
    toast.add({ title: 'This can\'t be added to an email.', icon: 'i-lucide-circle-alert', color: 'warning' })
    return
  }
  const notes = [insert.note, changed ? 'Some parts can\'t be shown in email and were simplified.' : ''].filter(Boolean)
  if (notes.length) toast.add({ title: notes.join(' '), icon: 'i-lucide-info', color: 'neutral' })
}
</script>

<template>
  <div
    class="rounded-md border border-(--ui-border) bg-(--ui-bg)"
    :class="props.disabled ? 'opacity-70 pointer-events-none' : ''"
  >
    <UEditor
      v-slot="{ editor }"
      v-model="doc"
      content-type="json"
      placeholder="Write your email…"
      :extensions="extensions"
      :editable="!props.disabled"
      :text-direction="props.dir"
      :ui="{ base: 'px-4 py-3 prose-sm max-w-none focus:outline-none min-h-64' }"
    >
      <div class="flex flex-wrap items-center gap-1 border-b border-(--ui-border) px-2 py-1 sticky top-0 bg-(--ui-bg) z-10">
        <UEditorToolbar
          :editor="editor"
          :items="items"
        />
        <template
          v-for="ins in inserters"
          :key="ins.id"
        >
          <UButton
            v-if="ins.picker"
            :icon="ins.icon"
            color="neutral"
            variant="ghost"
            size="sm"
            :label="ins.label"
            :disabled="props.disabled"
            @click="openPicker(editor, ins)"
          />
          <UDropdownMenu
            v-else-if="menuItems[ins.id]?.length"
            :items="menuItems[ins.id]!.map(item => ({ label: item.label, onSelect: () => insertContent(editor, item.insert()) }))"
          >
            <UButton
              :icon="ins.icon"
              color="neutral"
              variant="ghost"
              size="sm"
              :label="ins.label"
              :disabled="props.disabled"
            />
          </UDropdownMenu>
        </template>
        <UDropdownMenu
          v-if="props.variables.length"
          :items="props.variables.map(v => ({ label: `${v.label}  {${v.key}}`, onSelect: () => insert(editor, v.key) }))"
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
    <template
      v-for="ins in inserters"
      :key="ins.id"
    >
      <component
        :is="ins.picker.component"
        v-if="ins.picker"
        :open="pickerOpen === ins.id"
        :language="props.lang"
        @update:open="(o: boolean) => { if (!o && pickerOpen === ins.id) pickerOpen = null }"
        @select="(picked: unknown) => onPicked(ins, picked)"
      />
    </template>
  </div>
</template>
