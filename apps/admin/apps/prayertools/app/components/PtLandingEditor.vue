<script setup lang="ts">
// The landing page editor: fixed sections in a fixed order. The champion
// writes the "why" text and custom sections, hides sections they don't need,
// and chooses whether published stories show. Section headings and standard
// text can be reworded per language; the preview beside the editor shows
// unsaved changes.
import type { TiptapDoc, TranslatableText } from '@prayertools/shared/db/schema'
import { isEmptyDoc } from '@prayertools/shared/tiptap'
import { isTemplateWhy, templateWhyDoc } from '@prayertools/shared/i18n/landing'
import { videoEmbed } from '@prayertools/shared/video'

const props = withDefaults(defineProps<{ saveLabel?: string }>(), { saveLabel: 'Save landing page' })
const emit = defineEmits<{ saved: [] }>()

interface CustomSection {
  id: string
  heading: TranslatableText
  body: Record<string, Record<string, any>>
  image_url?: string
  image_alt?: TranslatableText
  video_url?: string
  button_label?: TranslatableText
  button_url?: string
}
interface Story { id: string, name: string | null, body: string, use_name: boolean, published: boolean }

const { data: site, refresh, can } = usePtSite()
const { data: meta } = usePtMeta()
const toast = usePtToast()

const lang = ref('en')
watch(site, (s) => {
  if (s && !s.site.languages.includes(lang.value)) lang.value = s.site.default_language
}, { immediate: true })
const isSource = computed(() => lang.value === site.value?.site.default_language)
const canWrite = computed(() => can('pt.site.write'))
const canEditLang = computed(() => isSource.value ? canWrite.value : can('pt.content.translate'))
const dir = computed(() => meta.value?.languages.find(l => l.code === lang.value)?.dir ?? 'ltr')

const why = ref<Record<string, Record<string, any> | null>>({})
const hidden = ref<string[]>([])
const stories = ref(true)
const custom = ref<CustomSection[]>([])
const description = ref<TranslatableText | null>(null)
const openIds = ref<string[]>([])
watch(site, (s) => {
  if (!s) return
  why.value = withTemplateWhy((s.site.landing?.why ?? {}) as Record<string, TiptapDoc>, s.site.template_key, s.site.languages, s.site.default_language)
  hidden.value = [...(s.site.landing?.hidden ?? meta.value?.templates.find(t => t.key === s.site.template_key)?.hiddenSections ?? [])]
  stories.value = s.site.landing?.stories !== false
  custom.value = JSON.parse(JSON.stringify(s.site.landing?.custom ?? []))
  description.value = s.site.description
  openIds.value = custom.value.filter(c => !c.heading.values[s.site.default_language]).map(c => c.id)
}, { immediate: true })

// Until the site writes its own "why" text in its default language, each
// language without its own text starts from the template's standard text.
function withTemplateWhy(own: Record<string, TiptapDoc>, templateKey: string | null, languages: string[], defaultLanguage: string) {
  const out = { ...own }
  if (own[defaultLanguage] && !isEmptyDoc(own[defaultLanguage])) return out
  for (const l of languages) {
    const standard = templateWhyDoc(templateKey, l)
    if (standard && (!out[l] || isEmptyDoc(out[l]))) out[l] = standard
  }
  return out
}
const whyIsStandard = computed(() => isTemplateWhy(why.value[lang.value] as TiptapDoc | null | undefined, site.value?.site.template_key, lang.value))

const whyDoc = computed({
  get: () => why.value[lang.value] ?? null,
  set: (v) => { why.value = { ...why.value, [lang.value]: v } }
})
const whyGuidance = computed(() => ptLandingGuidance('why', site.value?.site.template_key))

// Section headings and standard text: the site's own wording per language
// over the standard wording, which the preview reports for each language it
// shows. Text left equal to the standard wording is not stored.
const { data: strings, refresh: refreshStrings } = useFetch<{ strings: { key: string, language: string, value: string }[] }>('/api/pt/strings', { key: 'pt-strings' })
const wording = ref<Record<string, Record<string, string>>>({})
let savedWording: Record<string, Record<string, string>> = {}
watch([strings, site], () => {
  if (!site.value) return
  const out: Record<string, Record<string, string>> = Object.fromEntries(site.value.site.languages.map(l => [l, {}]))
  for (const row of strings.value?.strings ?? []) {
    if (out[row.language]) out[row.language]![row.key] = row.value
  }
  wording.value = out
  savedWording = JSON.parse(JSON.stringify(out))
}, { immediate: true })
const standardWording = ref<Record<string, Record<string, string>>>({})
function onPreviewDefaults(defaults: Record<string, string>) {
  standardWording.value = { ...standardWording.value, [lang.value]: defaults }
}
function textValue(key: string) {
  return wording.value[lang.value]?.[key] ?? standardWording.value[lang.value]?.[key] ?? ''
}
function setText(key: string, value: string) {
  wording.value = { ...wording.value, [lang.value]: { ...wording.value[lang.value], [key]: value } }
}
function isOwnText(key: string) {
  const own = wording.value[lang.value]?.[key]
  return own !== undefined && own.trim() !== (standardWording.value[lang.value]?.[key] ?? '').trim()
}
function resetText(key: string) {
  const { [key]: _removed, ...rest } = wording.value[lang.value] ?? {}
  wording.value = { ...wording.value, [lang.value]: rest }
}
function sectionTitle(key: string) {
  const titleKey = PT_LANDING_TEXT_FIELDS[key]?.[0]?.key
  return (titleKey && textValue(titleKey).trim()) || ptLandingSectionInfo(key).title
}
async function saveWording() {
  const s = site.value!
  for (const l of s.site.languages) {
    if (l === s.site.default_language ? !canWrite.value : !can('pt.content.translate')) continue
    const current = wording.value[l] ?? {}
    const saved = savedWording[l] ?? {}
    for (const key of new Set([...Object.keys(current), ...Object.keys(saved)])) {
      let value = (current[key] ?? '').trim()
      if (value === (standardWording.value[l]?.[key] ?? '').trim()) value = ''
      if (value !== (saved[key] ?? '').trim()) {
        await $fetch('/api/pt/strings', { method: 'PUT', body: { key, language: l, value } })
      }
    }
  }
  await refreshStrings()
}
const sections = computed(() => (meta.value?.landing.sections ?? []).map(key => ({
  key,
  ...ptLandingSectionInfo(key),
  title: sectionTitle(key),
  required: !(meta.value?.landing.hideable ?? []).includes(key)
})))
// The stories section shows only when it is not hidden and the stories flag is on.
function isShown(key: string) {
  return !hidden.value.includes(key) && (key !== 'stories' || stories.value)
}
function setShown(key: string, show: boolean) {
  hidden.value = show ? hidden.value.filter(x => x !== key) : [...new Set([...hidden.value, key])]
  if (key === 'stories') stories.value = show
}

const { data: storyData, execute: loadStories } = useFetch<{ stories: Story[] }>('/api/pt/stories', { key: 'pt-stories', immediate: false })
watch(() => can('pt.intercessors.read'), (ok) => {
  if (ok) loadStories()
}, { immediate: true })
const landingStories = computed(() => (storyData.value?.stories ?? []).filter(s => s.published))

function addSection() {
  const l = site.value!.site.default_language
  const id = crypto.randomUUID()
  custom.value.push({ id, heading: { source: l, values: { [l]: '' }, stale: [] }, body: {} })
  openIds.value = [...openIds.value, id]
}
function toggleOpen(id: string) {
  openIds.value = openIds.value.includes(id) ? openIds.value.filter(x => x !== id) : [...openIds.value, id]
}
function moveSection(i: number, d: number) {
  const j = i + d
  if (j < 0 || j >= custom.value.length) return
  const arr = [...custom.value]
  ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
  custom.value = arr
}
const removeId = ref<string | null>(null)
const removeOpen = computed({
  get: () => !!removeId.value,
  set: (v: boolean) => { if (!v) removeId.value = null }
})
function removeSection() {
  custom.value = custom.value.filter(s => s.id !== removeId.value)
  removeId.value = null
}
function clearImage(s: CustomSection) {
  s.image_url = undefined
  s.image_alt = undefined
}

const imagePickerFor = ref<string | null>(null)

const videoInput = ref<HTMLInputElement>()
const videoFor = ref<string | null>(null)
const uploadingVideo = ref<string | null>(null)
function videoError(s: CustomSection) {
  return s.video_url?.trim() && !videoEmbed(s.video_url) ? 'Use a YouTube or Vimeo link, or a link to an MP4, WebM or MOV file.' : undefined
}
function clearVideo(s: CustomSection) {
  s.video_url = undefined
}
function pickVideo(id: string) {
  videoFor.value = id
  videoInput.value?.click()
}
async function uploadVideo(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  const id = videoFor.value
  input.value = ''
  if (!file || !id) return
  uploadingVideo.value = id
  try {
    const form = new FormData()
    form.append('file', file)
    const res = await $fetch<{ url: string }>('/api/pt/videos', { method: 'POST', body: form })
    const s = custom.value.find(x => x.id === id)
    if (s) s.video_url = res.url
  } catch (err) {
    toast.fail(err, 'Upload failed')
  } finally {
    uploadingVideo.value = null
  }
}

const draft = computed(() => ({ landing: { why: why.value, hidden: hidden.value, stories: stories.value, custom: custom.value }, description: description.value, strings: wording.value[lang.value] ?? {} }))
const preview = ref<{ focus: (section: string, id?: string) => void }>()

// The selected section ('why', or 'custom-<id>' for one custom section) stays
// highlighted here and in the preview until another one is chosen.
const selected = ref<string | null>(null)
function select(section: string, id?: string) {
  const target = id ? `custom-${id}` : section
  if (selected.value === target) return
  selected.value = target
  preview.value?.focus(section, id)
}
function onPreviewSelect(section: string, id?: string) {
  if (id && !openIds.value.includes(id)) openIds.value = [...openIds.value, id]
  selected.value = id ? `custom-${id}` : section
  nextTick(() => document.getElementById(`pt-ed-${selected.value}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    if (!canWrite.value) {
      await saveTranslation()
      await saveWording()
      await refresh()
      toast.ok('Translation saved')
      return
    }
    await $fetch('/api/pt/site', { method: 'PATCH', body: { description: description.value, landing: { why: why.value, hidden: hidden.value, stories: stories.value, custom: custom.value } } })
    await saveWording()
    await refresh()
    toast.ok('Landing page saved')
    emit('saved')
  } catch (err) {
    toast.fail(err)
  } finally {
    saving.value = false
  }
}

// Translators save only the current language, one field at a time.
async function saveTranslation() {
  const l = lang.value
  const put = (body: Record<string, unknown>) => $fetch('/api/pt/site/translation', { method: 'PUT', body: { lang: l, ...body } })
  if (description.value?.values[l] !== undefined) await put({ field: 'description', value: description.value.values[l] })
  if (why.value[l]) await put({ field: 'why', value: why.value[l] })
  for (const s of custom.value) {
    if (s.heading.values[l] !== undefined) await put({ field: 'custom', sectionId: s.id, part: 'heading', value: s.heading.values[l] })
    if (s.body[l]) await put({ field: 'custom', sectionId: s.id, part: 'body', value: s.body[l] })
    if (s.button_label?.values[l] !== undefined) await put({ field: 'custom', sectionId: s.id, part: 'button_label', value: s.button_label.values[l] })
  }
}

async function translateWhy() {
  const s = site.value!
  const src = why.value[s.site.default_language]
  if (!src) return
  try {
    const res = await $fetch<{ doc: Record<string, any> }>('/api/pt/translate', { method: 'POST', body: { doc: src, from: s.site.default_language, to: lang.value } })
    whyDoc.value = res.doc
  } catch (err) {
    toast.fail(err, 'Translation failed')
  }
}
</script>

<template>
  <div
    v-if="site"
    class="space-y-6"
  >
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <slot name="heading" />
      </div>
      <div class="flex gap-2 items-center">
        <USelect
          v-if="site.site.languages.length > 1"
          v-model="lang"
          :items="site.site.languages.map(l => ({ label: languageName(meta, l), value: l }))"
          icon="i-lucide-languages"
          class="w-44"
        />
        <UButton
          :href="site.url"
          target="_blank"
          variant="soft"
          icon="i-lucide-external-link"
          label="View page"
          class="lg:hidden"
        />
      </div>
    </div>

    <div class="grid gap-6 lg:grid-cols-[minmax(0,32rem)_minmax(0,1fr)] lg:items-start">
      <div class="min-w-0 space-y-4">
        <PtLandingBox
          v-for="s in sections"
          :key="s.key"
          :section="s.key"
          :title="s.title"
          :description="s.description"
          :icon="s.icon"
          :selected="selected === s.key"
          :shown="s.required ? null : isShown(s.key)"
          :can-toggle="canWrite"
          @select="select(s.key)"
          @update:shown="(v: boolean) => setShown(s.key, v)"
        >
          <template #actions>
            <UButton
              v-if="s.key === 'why' && !isSource && canEditLang"
              size="sm"
              variant="soft"
              icon="i-lucide-languages"
              label="AI translate"
              @click.stop="translateWhy"
            />
          </template>
          <template #default>
            <div
              v-if="PT_LANDING_TEXT_FIELDS[s.key]"
              class="space-y-3"
            >
              <UFormField
                v-for="f in PT_LANDING_TEXT_FIELDS[s.key]"
                :key="f.key"
                :label="f.label"
              >
                <template #hint>
                  <UButton
                    v-if="isOwnText(f.key) && canEditLang"
                    size="xs"
                    variant="link"
                    color="neutral"
                    label="Use standard wording"
                    class="p-0"
                    @click.stop="resetText(f.key)"
                  />
                </template>
                <UTextarea
                  v-if="f.multiline"
                  :model-value="textValue(f.key)"
                  :rows="2"
                  autoresize
                  :dir="dir"
                  :disabled="!canEditLang"
                  class="w-full"
                  @update:model-value="v => setText(f.key, String(v))"
                />
                <UInput
                  v-else
                  :model-value="textValue(f.key)"
                  :dir="dir"
                  :disabled="!canEditLang"
                  class="w-full"
                  @update:model-value="v => setText(f.key, String(v))"
                />
              </UFormField>
              <p
                v-if="PT_LANDING_TEXT_FIELDS[s.key]!.some(f => textValue(f.key).includes('{site}'))"
                class="text-xs text-(--ui-text-muted)"
              >
                {site} is replaced by the site name.
              </p>
            </div>

            <template v-if="s.key === 'top'">
              <div class="space-y-3">
                <p class="text-sm text-(--ui-text-muted)">
                  The hero image and colors are set under
                  <ULink
                    :to="`/@${site.org.slug}/site/settings?tab=look`"
                    class="text-(--ui-primary)"
                  >Settings → Look</ULink>.
                </p>
                <PtTranslatableInput
                  v-model="description"
                  :languages="site.site.languages"
                  :default-language="site.site.default_language"
                  label="Short description"
                  help="Shown under the site name, and used in link previews and the Prayer.Tools directory."
                  multiline
                  :source-locked="!canWrite"
                />
              </div>
            </template>

            <div
              v-else-if="s.key === 'why'"
              class="space-y-3"
            >
              <UAlert
                v-if="whyGuidance && canEditLang"
                color="neutral"
                variant="subtle"
                icon="i-lucide-lightbulb"
                :description="whyGuidance"
              />
              <PtRichEditor
                v-model="whyDoc"
                :dir="dir"
                :disabled="!canEditLang"
                placeholder="Why should people pray? Who are you praying for?"
              />
              <p
                v-if="whyIsStandard"
                class="text-xs text-(--ui-text-muted)"
              >
                This is the {{ PT_LABELS.template[site.site.template_key ?? ''] ?? 'template' }} template's standard text. Visitors see it until you change it.
              </p>
            </div>

            <div
              v-else-if="s.key === 'custom'"
              class="space-y-2"
            >
              <div
                v-for="(c, i) in custom"
                :id="`pt-ed-custom-${c.id}`"
                :key="c.id"
                class="scroll-mt-20 rounded-md border border-(--ui-border) transition-[box-shadow,background-color]"
                :class="selected === `custom-${c.id}` ? PT_LANDING_SELECTED : ''"
                @click.stop="select('custom', c.id)"
                @focusin.stop="select('custom', c.id)"
              >
                <div class="flex items-center gap-2 px-3 py-2">
                  <UButton
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    :icon="openIds.includes(c.id) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                    :aria-label="openIds.includes(c.id) ? 'Collapse' : 'Expand'"
                    @click="toggleOpen(c.id)"
                  />
                  <span class="flex-1 truncate text-sm font-medium">{{ c.heading.values[site.site.default_language] || 'New section' }}</span>
                  <template v-if="canWrite">
                    <UButton
                      size="xs"
                      variant="ghost"
                      color="neutral"
                      icon="i-lucide-arrow-up"
                      aria-label="Move up"
                      :disabled="i === 0"
                      @click="moveSection(i, -1)"
                    />
                    <UButton
                      size="xs"
                      variant="ghost"
                      color="neutral"
                      icon="i-lucide-arrow-down"
                      aria-label="Move down"
                      :disabled="i === custom.length - 1"
                      @click="moveSection(i, 1)"
                    />
                    <UButton
                      size="xs"
                      variant="ghost"
                      color="error"
                      icon="i-lucide-trash-2"
                      aria-label="Remove section"
                      @click="removeId = c.id"
                    />
                  </template>
                </div>
                <div
                  v-if="openIds.includes(c.id)"
                  class="space-y-4 border-t border-(--ui-border) p-3"
                >
                  <PtTranslatableInput
                    v-model="c.heading"
                    :languages="site.site.languages"
                    :default-language="site.site.default_language"
                    label="Heading"
                    :source-locked="!canWrite"
                  />
                  <UFormField :label="site.site.languages.length > 1 ? `Text (${languageName(meta, lang)})` : 'Text'">
                    <PtRichEditor
                      :model-value="c.body[lang] ?? null"
                      :dir="dir"
                      :disabled="!canEditLang"
                      min-height="8rem"
                      @update:model-value="(v) => { c.body = { ...c.body, [lang]: v as Record<string, any> } }"
                    />
                  </UFormField>
                  <UFormField
                    label="Image"
                    description="Optional."
                  >
                    <div class="flex flex-wrap items-center gap-3">
                      <img
                        v-if="c.image_url"
                        :src="c.image_url"
                        alt=""
                        class="h-20 rounded-md object-cover"
                      >
                      <template v-if="canWrite">
                        <UButton
                          size="sm"
                          variant="soft"
                          icon="i-lucide-image"
                          :label="c.image_url ? 'Change image' : 'Add image'"
                          @click="imagePickerFor = c.id"
                        />
                        <UButton
                          v-if="c.image_url"
                          size="sm"
                          variant="ghost"
                          color="neutral"
                          icon="i-lucide-x"
                          label="Remove"
                          @click="clearImage(c)"
                        />
                      </template>
                    </div>
                  </UFormField>
                  <UFormField
                    label="Video"
                    description="Optional. A YouTube or Vimeo link, or a video file you upload."
                    :error="videoError(c)"
                  >
                    <div class="space-y-2">
                      <UInput
                        v-model="c.video_url"
                        type="url"
                        placeholder="YouTube or Vimeo link"
                        class="w-full"
                        :disabled="!canWrite"
                      />
                      <div
                        v-if="canWrite"
                        class="flex flex-wrap gap-2"
                      >
                        <UButton
                          size="sm"
                          variant="soft"
                          icon="i-lucide-upload"
                          label="Upload a video"
                          :loading="uploadingVideo === c.id"
                          :disabled="!!uploadingVideo"
                          @click="pickVideo(c.id)"
                        />
                        <UButton
                          v-if="c.video_url"
                          size="sm"
                          variant="ghost"
                          color="neutral"
                          icon="i-lucide-x"
                          label="Remove"
                          @click="clearVideo(c)"
                        />
                      </div>
                      <p
                        v-if="canWrite"
                        class="text-xs text-(--ui-text-muted)"
                      >
                        MP4, WebM or MOV up to 100 MB.
                      </p>
                    </div>
                  </UFormField>
                  <PtTranslatableInput
                    v-model="c.button_label"
                    :languages="site.site.languages"
                    :default-language="site.site.default_language"
                    label="Button text"
                    help="Optional. Shown when a link is set."
                    :source-locked="!canWrite"
                  />
                  <UFormField
                    label="Button link"
                    description="Web address the button opens."
                  >
                    <UInput
                      v-model="c.button_url"
                      type="url"
                      placeholder="https://"
                      class="w-full"
                      :disabled="!canWrite"
                    />
                  </UFormField>
                </div>
              </div>
              <UButton
                v-if="canWrite"
                variant="soft"
                icon="i-lucide-plus"
                label="Add a section"
                @click="addSection"
              />
            </div>

            <div
              v-else-if="s.key === 'stories'"
              class="space-y-2"
            >
              <p class="text-sm text-(--ui-text-muted)">
                Only stories you publish show, and names only when the writer allowed it.
              </p>
              <template v-if="can('pt.intercessors.read')">
                <p
                  v-if="!landingStories.length"
                  class="text-sm text-(--ui-text-muted)"
                >
                  No stories published yet. The page shows the section once you publish one.
                </p>
                <div
                  v-for="st in landingStories"
                  :key="st.id"
                  class="rounded-md bg-(--ui-bg-elevated) p-3 text-sm"
                >
                  <p class="line-clamp-3 whitespace-pre-line">
                    {{ st.body }}
                  </p>
                  <p class="mt-1 text-xs text-(--ui-text-muted)">
                    {{ st.use_name && st.name ? st.name : 'Anonymous' }}
                  </p>
                </div>
                <UButton
                  :to="`/@${site.org.slug}/site/landing/stories`"
                  variant="link"
                  icon="i-lucide-heart-handshake"
                  label="Stories"
                  class="px-0"
                />
              </template>
            </div>

            <div v-else-if="s.key === 'signup'" class="space-y-2">
              <ULink
                :to="`/@${site.org.slug}/site/landing/signup-form`"
                target="_blank"
                rel="noopener"
                class="inline-flex items-center gap-1 text-sm text-(--ui-primary)"
              >
                Edit the signup form (opens a new tab)
                <UIcon name="i-lucide-external-link" class="size-4" />
              </ULink>
              <p class="text-sm text-(--ui-text-muted)">Your landing-page edits stay here. Close the form settings tab when finished, then continue setup on this page.</p>
            </div>
          </template>
        </PtLandingBox>

        <div class="flex justify-end sticky bottom-4">
          <UButton
            :label="canWrite ? props.saveLabel : 'Save translation'"
            size="lg"
            icon="i-lucide-save"
            :loading="saving"
            @click="save"
          />
        </div>
      </div>

      <PtLandingPreview
        ref="preview"
        :site-url="site!.url"
        :lang="lang"
        :default-language="site!.site.default_language"
        :draft="draft"
        class="hidden lg:flex sticky top-20 h-[calc(100dvh-6rem)]"
        @select="onPreviewSelect"
        @defaults="onPreviewDefaults"
      />
    </div>

    <UModal
      v-model:open="removeOpen"
      title="Remove this section?"
      description="Its text in every language is removed when you save the landing page."
    >
      <template #footer>
        <div class="flex gap-2">
          <UButton
            color="error"
            label="Remove"
            @click="removeSection"
          />
          <UButton
            variant="ghost"
            color="neutral"
            label="Cancel"
            @click="removeId = null"
          />
        </div>
      </template>
    </UModal>

    <input
      ref="videoInput"
      type="file"
      accept="video/mp4,video/webm,video/quicktime"
      class="hidden"
      @change="uploadVideo"
    >

    <PtImagePicker
      :open="!!imagePickerFor"
      :language="site!.site.default_language"
      @update:open="(v) => { if (!v) imagePickerFor = null }"
      @select="(a) => { const s = custom.find(x => x.id === imagePickerFor); if (s) { s.image_url = a.url; s.image_alt = { source: site!.site.default_language, values: { [site!.site.default_language]: a.alt } } } imagePickerFor = null }"
    />
  </div>
</template>
