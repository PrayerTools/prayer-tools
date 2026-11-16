<script setup lang="ts">
import type { MarketingDraft, MarketingLanguage, MarketingVariable, MarketingVersion, MarketingVersions } from '../utils/marketing-ui'
import { marketingEmptyVersion, marketingErrorMessage, marketingHasText } from '../utils/marketing-ui'

const props = withDefaults(defineProps<{
  languages: MarketingLanguage[]
  variables: MarketingVariable[]
  preview: (lang: string) => Promise<{ subject: string, html: string, lang: string }>
  sendTest: (lang: string) => Promise<string>
  translateHeaders?: Record<string, string>
  disabled?: boolean
}>(), { translateHeaders: () => ({}), disabled: false })

const draft = defineModel<MarketingDraft>({ required: true })
const toast = useToast()
const appConfig = useAppConfig() as { marketing?: { translateEndpoint?: string } }

const active = ref(draft.value.source_language)

const ordered = computed(() => {
  const src = props.languages.find(l => l.code === draft.value.source_language)
  return [...(src ? [src] : []), ...props.languages.filter(l => l.code !== draft.value.source_language)]
})

const sourceItems = computed(() => props.languages.map(l => ({ label: l.label, value: l.code })))

// Every site language has a version to edit; empty ones are never sent.
watch([() => props.languages, () => draft.value.versions], () => {
  const missing = props.languages.filter(l => !draft.value.versions[l.code])
  if (missing.length) draft.value.versions = { ...draft.value.versions, ...Object.fromEntries(missing.map(l => [l.code, marketingEmptyVersion()])) }
}, { immediate: true })

function complete(lang: string): boolean {
  const v = draft.value.versions[lang]
  return !!v && !!v.subject.trim() && marketingHasText(v.content)
}

const tabs = computed(() => ordered.value.map(l => ({
  label: l.code === draft.value.source_language ? `${l.label} (source)` : l.label,
  value: l.code,
  icon: complete(l.code) ? 'i-lucide-circle-check' : 'i-lucide-circle-dashed'
})))

watch(() => draft.value.source_language, (lang) => {
  if (!props.languages.some(l => l.code === active.value)) active.value = lang
})
watch(() => props.languages, (langs) => {
  if (!langs.some(l => l.code === active.value)) active.value = draft.value.source_language
})

const current = computed(() => draft.value.versions[active.value] ?? marketingEmptyVersion())
const currentDir = computed(() => props.languages.find(l => l.code === active.value)?.dir ?? 'ltr')
const sourceLabel = computed(() => props.languages.find(l => l.code === draft.value.source_language)?.label ?? draft.value.source_language)

// ── AI translate ────────────────────────────────────────────────────────────
const translating = ref(false)
async function translate() {
  const src = draft.value.versions[draft.value.source_language]
  if (!src || !appConfig.marketing?.translateEndpoint) return
  translating.value = true
  try {
    const endpoint = appConfig.marketing.translateEndpoint
    const base = { from: draft.value.source_language, to: active.value }
    const [doc, texts] = await Promise.all([
      $fetch<{ doc: MarketingVersion['content'] }>(endpoint, { method: 'POST', body: { ...base, doc: src.content }, headers: props.translateHeaders }),
      $fetch<{ texts: string[] }>(endpoint, { method: 'POST', body: { ...base, texts: [src.subject || ' ', src.preheader || ' '] }, headers: props.translateHeaders })
    ])
    draft.value.versions = {
      ...draft.value.versions,
      [active.value]: { subject: (texts.texts[0] ?? '').trim(), preheader: (texts.texts[1] ?? '').trim(), content: doc.doc }
    }
    toast.add({ title: 'Translated. Please read it through before sending.', icon: 'i-lucide-languages', color: 'success' })
  } catch (err) {
    toast.add({ title: 'Translation failed', description: marketingErrorMessage(err), color: 'warning' })
  } finally {
    translating.value = false
  }
}

// ── Preview and test ────────────────────────────────────────────────────────
const previewOpen = ref(false)
const previewing = ref(false)
const previewData = ref<{ subject: string, html: string, lang: string } | null>(null)
async function openPreview() {
  previewing.value = true
  try {
    previewData.value = await props.preview(active.value)
    previewOpen.value = true
  } catch (err) {
    toast.add({ title: 'Preview failed', description: marketingErrorMessage(err), color: 'error' })
  } finally {
    previewing.value = false
  }
}

const testing = ref(false)
async function test() {
  testing.value = true
  try {
    const to = await props.sendTest(active.value)
    toast.add({ title: `Test sent to ${to}`, icon: 'i-lucide-send', color: 'success' })
  } catch (err) {
    toast.add({ title: 'Test failed', description: marketingErrorMessage(err), color: 'error' })
  } finally {
    testing.value = false
  }
}

// ── Personal templates ──────────────────────────────────────────────────────
interface Template { id: string, name: string, versions: MarketingVersions, source_language: string, updated_at: string }
const templatesOpen = ref(false)
const templates = ref<Template[]>([])
const saveOpen = ref(false)
const templateName = ref('')
const savingTemplate = ref(false)

async function openTemplates() {
  try {
    templates.value = (await $fetch<{ templates: Template[] }>('/api/marketing/templates')).templates
    templatesOpen.value = true
  } catch (err) {
    toast.add({ title: 'Could not load templates', description: marketingErrorMessage(err), color: 'error' })
  }
}

function useTemplate(t: Template) {
  const codes = props.languages.map(l => l.code)
  const versions: MarketingVersions = {}
  for (const [lang, v] of Object.entries(t.versions)) if (codes.includes(lang)) versions[lang] = v
  const source = codes.includes(t.source_language) ? t.source_language : draft.value.source_language
  if (!versions[source]) versions[source] = t.versions[t.source_language] ?? marketingEmptyVersion()
  draft.value = { ...draft.value, versions, source_language: source }
  active.value = source
  templatesOpen.value = false
  toast.add({ title: `Started from "${t.name}"`, color: 'success' })
}

async function saveTemplate() {
  savingTemplate.value = true
  try {
    await $fetch('/api/marketing/templates', { method: 'POST', body: { name: templateName.value, versions: draft.value.versions, source_language: draft.value.source_language } })
    saveOpen.value = false
    toast.add({ title: 'Saved to your templates', icon: 'i-lucide-bookmark', color: 'success' })
  } catch (err) {
    toast.add({ title: 'Could not save the template', description: marketingErrorMessage(err), color: 'error' })
  } finally {
    savingTemplate.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-end gap-3">
      <UFormField
        label="Written in"
        class="w-56"
      >
        <USelect
          v-model="draft.source_language"
          :items="sourceItems"
          :disabled="disabled"
          class="w-full"
        />
      </UFormField>
      <div class="flex-1" />
      <UButton
        v-if="!disabled"
        label="Start from a template"
        icon="i-lucide-layout-template"
        color="neutral"
        variant="ghost"
        @click="openTemplates"
      />
      <UButton
        label="Save as template"
        icon="i-lucide-bookmark-plus"
        color="neutral"
        variant="ghost"
        :disabled="!complete(draft.source_language)"
        @click="templateName = draft.versions[draft.source_language]?.subject ?? ''; saveOpen = true"
      />
    </div>

    <UTabs
      v-model="active"
      :items="tabs"
      :content="false"
      variant="link"
    />

    <div
      :key="active"
      class="space-y-3"
    >
      <div
        v-if="active !== draft.source_language"
        class="flex flex-wrap items-center gap-2 text-sm text-(--ui-text-muted)"
      >
        <UButton
          v-if="!disabled"
          label="AI translate"
          icon="i-lucide-languages"
          variant="soft"
          size="sm"
          :loading="translating"
          :disabled="!complete(draft.source_language)"
          @click="translate"
        />
        <span>Leave this language empty and its readers get the {{ sourceLabel }} version.</span>
      </div>
      <UFormField label="Subject">
        <UInput
          v-model="current.subject"
          :dir="currentDir"
          :disabled="disabled"
          :maxlength="200"
          class="w-full"
        />
      </UFormField>
      <UFormField
        label="Preview text"
        help="Shown after the subject in most inboxes."
      >
        <UInput
          v-model="current.preheader"
          :dir="currentDir"
          :disabled="disabled"
          :maxlength="200"
          class="w-full"
        />
      </UFormField>
      <MarketingEditor
        v-model="current.content"
        :variables="variables"
        :dir="currentDir"
        :lang="active"
        :disabled="disabled"
      />
    </div>

    <div class="flex flex-wrap gap-2">
      <UButton
        label="Preview"
        icon="i-lucide-eye"
        color="neutral"
        variant="outline"
        :loading="previewing"
        @click="openPreview"
      />
      <UButton
        label="Send me a test"
        icon="i-lucide-send"
        color="neutral"
        variant="outline"
        :loading="testing"
        :disabled="!complete(draft.source_language)"
        @click="test"
      />
    </div>

    <UModal
      v-model:open="previewOpen"
      :title="previewData?.subject || 'Preview'"
      description="Placeholders show sample values. The footer shows the site's unsubscribe link."
      :ui="{ content: 'max-w-3xl' }"
    >
      <template #body>
        <iframe
          v-if="previewData"
          :srcdoc="previewData.html"
          sandbox=""
          title="Email preview"
          class="w-full h-[70vh] rounded border border-(--ui-border) bg-white"
        />
      </template>
    </UModal>

    <UModal
      v-model:open="templatesOpen"
      title="Your templates"
      description="Templates belong to you and work on any of your sites."
    >
      <template #body>
        <p
          v-if="!templates.length"
          class="text-sm text-(--ui-text-muted)"
        >
          No templates yet. Use "Save as template" on an email to add one.
        </p>
        <ul class="divide-y divide-(--ui-border)">
          <li
            v-for="t in templates"
            :key="t.id"
            class="flex items-center justify-between gap-2 py-2"
          >
            <div class="min-w-0">
              <p class="font-medium truncate">
                {{ t.name }}
              </p>
              <p class="text-xs text-(--ui-text-muted) truncate">
                {{ t.versions[t.source_language]?.subject }}
              </p>
            </div>
            <UButton
              label="Use"
              size="sm"
              @click="useTemplate(t)"
            />
          </li>
        </ul>
      </template>
    </UModal>

    <UModal
      v-model:open="saveOpen"
      title="Save as template"
    >
      <template #body>
        <UFormField label="Template name">
          <UInput
            v-model="templateName"
            class="w-full"
            :maxlength="120"
          />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="saveOpen = false"
          />
          <UButton
            label="Save"
            :loading="savingTemplate"
            :disabled="!templateName.trim()"
            @click="saveTemplate"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
