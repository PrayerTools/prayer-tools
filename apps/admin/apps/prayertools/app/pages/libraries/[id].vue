<script setup lang="ts">
// A library: its details, the entry grid (days × languages) and the draft
// editor. Drafts reach sites only when the library is published; sites that
// edited their copy are never changed.
definePageMeta({ middleware: 'auth', tenantExempt: true })

const route = useRoute()
const id = computed(() => String(route.params.id))
const { data: meta } = usePtMeta()
const toast = usePtToast()
// The back link returns operators to the admin library list when they came from it.
const fromAdmin = String(useRouter().options.history.state.back ?? '').startsWith('/admin/pt/libraries')
const { data, refresh } = useFetch<{ library: Record<string, any>, entries: { day: number, language: string, unpublished: boolean }[], canEdit: boolean, role: 'owner' | 'editor' | 'viewer' | null, usage: { following: number, copies: number } | null }>(() => `/api/pt/libraries/${id.value}`, { key: computed(() => `pt-library-${id.value}`) })

const lib = computed(() => data.value?.library)
const form = ref<Record<string, any>>({})
watch(lib, l => { if (l) form.value = { title: l.title, description: l.description, cadence: l.cadence, source_language: l.source_language, license: l.license, license_note: l.license_note, credit: l.credit, topics: l.topics, template_keys: l.template_keys, series: l.series, edition: l.edition } }, { immediate: true })

const languages = computed(() => {
  const set = new Set([lib.value?.source_language, ...(data.value?.entries ?? []).map(e => e.language)].filter(Boolean) as string[])
  return [...set]
})
const addLanguage = ref<string | undefined>()
const maxDay = computed(() => Math.max(0, ...(data.value?.entries ?? []).map(e => e.day)))
function cell(day: number, lang: string) {
  return data.value?.entries.find(e => e.day === day && e.language === lang)
}
const unpublishedCount = computed(() => (data.value?.entries ?? []).filter(e => e.unpublished).length)

const editor = reactive({ open: false, day: 1, lang: 'en', doc: null as Record<string, any> | null, published: null as Record<string, any> | null })
async function openEntry(day: number, lang: string) {
  const res = await $fetch<{ draft?: Record<string, any> | null, published: Record<string, any> | null }>(`/api/pt/libraries/${id.value}/entries/${day}/${lang}`)
  Object.assign(editor, { open: true, day, lang, doc: res.draft ?? res.published ?? null, published: res.published })
}
async function saveEntry() {
  try {
    await $fetch(`/api/pt/libraries/${id.value}/entries/${editor.day}/${editor.lang}`, { method: 'PUT', body: { doc: editor.doc } })
    editor.open = false
    await refresh()
  } catch (err) {
    toast.fail(err)
  }
}
async function translateEntry() {
  try {
    const src = await $fetch<{ draft?: Record<string, any> | null }>(`/api/pt/libraries/${id.value}/entries/${editor.day}/${lib.value!.source_language}`)
    if (!src.draft) throw new Error('Write this day in the source language first.')
    const res = await $fetch<{ doc: Record<string, any> }>('/api/pt/libraries/translate', { method: 'POST', body: { doc: src.draft, from: lib.value!.source_language, to: editor.lang } })
    editor.doc = res.doc
  } catch (err) {
    toast.fail(err, 'Translation failed')
  }
}
async function saveMeta() {
  try {
    await $fetch(`/api/pt/libraries/${id.value}`, { method: 'PATCH', body: form.value })
    await refresh()
    toast.ok('Saved')
  } catch (err) {
    toast.fail(err)
  }
}
async function publish() {
  try {
    const res = await $fetch<{ version: number }>(`/api/pt/libraries/${id.value}/publish`, { method: 'POST' })
    await refresh()
    toast.ok(`Published version ${res.version}`, 'Sites that follow this library now show it.')
  } catch (err) {
    toast.fail(err)
  }
}
const peopleOpen = ref(false)
watch(peopleOpen, (open) => {
  if (!open) refresh()
})
const shareOpen = ref(false)
const rights = ref(false)
async function requestShare() {
  try {
    await $fetch(`/api/pt/libraries/${id.value}/share-request`, { method: 'POST', body: { rights_confirmed: rights.value } })
    shareOpen.value = false
    await refresh()
    toast.ok('Sent to Prayer.Tools for review')
  } catch (err) {
    toast.fail(err)
  }
}
const deleteOpen = ref(false)
const deleting = ref(false)
const deleteBlocked = computed(() => {
  if (lib.value?.visibility === 'published' && lib.value?.owner_user_id) return 'Shared libraries can\'t be deleted; ask Prayer.Tools to withdraw it.'
  const n = data.value?.usage?.following ?? 0
  return n ? `${n} ${n === 1 ? 'site follows' : 'sites follow'} this library, so their prayer content would disappear. Remove it from those campaigns first.` : ''
})
async function deleteLibrary() {
  deleting.value = true
  try {
    const platform = !lib.value?.owner_user_id
    await $fetch(`/api/pt/libraries/${id.value}`, { method: 'DELETE' })
    toast.ok(`Deleted “${lib.value?.title}”`)
    await navigateTo(platform ? '/admin/pt/libraries' : '/libraries')
  } catch (err) {
    toast.fail(err, 'Could not delete')
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div
    v-if="lib && data"
    class="max-w-6xl mx-auto space-y-6"
  >
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <UButton
          :to="fromAdmin ? '/admin/pt/libraries' : '/libraries'"
          icon="i-lucide-arrow-left"
          variant="link"
          color="neutral"
          :label="fromAdmin ? 'Platform libraries' : 'Libraries'"
          class="px-0"
        />
        <h1 class="text-2xl font-semibold">
          {{ lib.title }}
        </h1>
        <p class="text-sm text-(--ui-text-muted)">
          By {{ lib.owner_name }} · version {{ lib.published_version }}<span v-if="lib.published_at">, published {{ ptFormatDate(lib.published_at) }}</span>
        </p>
      </div>
      <div class="flex gap-2">
        <UButton
          :to="`/api/pt/libraries/${id}/export`"
          external
          download
          variant="outline"
          color="neutral"
          icon="i-lucide-download"
          label="Export"
        />
        <UButton
          v-if="data.role"
          variant="outline"
          color="neutral"
          icon="i-lucide-users"
          :label="data.role === 'owner' ? 'Share with people' : 'Shared with you'"
          @click="peopleOpen = true"
        />
        <UButton
          v-if="lib.visibility !== 'published' && lib.owner_user_id && data.role === 'owner'"
          variant="outline"
          label="Share with everyone…"
          :disabled="lib.share_status === 'requested'"
          @click="shareOpen = true"
        />
        <UButton
          v-if="data.canEdit"
          icon="i-lucide-upload"
          :label="unpublishedCount ? `Publish ${unpublishedCount} change${unpublishedCount === 1 ? '' : 's'}` : 'Published'"
          :disabled="!unpublishedCount"
          @click="publish"
        />
        <UButton
          v-if="data.canEdit && data.role !== 'editor'"
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
          aria-label="Delete library"
          @click="deleteOpen = true"
        />
      </div>
    </div>

    <UCard v-if="data.canEdit">
      <template #header>
        <h2 class="font-semibold">
          Details
        </h2>
      </template>
      <div class="grid sm:grid-cols-2 gap-4">
        <UFormField label="Title">
          <UInput
            v-model="form.title"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Credit line">
          <UInput
            v-model="form.credit"
            class="w-full"
          />
        </UFormField>
        <UFormField
          label="Description"
          class="sm:col-span-2"
        >
          <UTextarea
            v-model="form.description"
            class="w-full"
          />
        </UFormField>
        <UFormField label="License">
          <USelect
            v-model="form.license"
            :items="(meta?.licenses ?? []).map(l => ({ value: l, label: PT_LABELS.license[l] }))"
            class="w-full"
          />
        </UFormField>
        <UFormField
          v-if="form.license === 'other' || form.license === 'permission'"
          label="License details"
        >
          <UInput
            v-model="form.license_note"
            class="w-full"
          />
        </UFormField>
        <UFormField
          label="Topics"
          help="The catalog filters by topic."
        >
          <UInputTags
            v-model="form.topics"
            class="w-full"
          />
        </UFormField>
        <UFormField
          label="Suggested with templates"
        >
          <USelectMenu
            v-model="form.template_keys"
            :items="Object.entries(PT_LABELS.template).map(([value, label]) => ({ value, label }))"
            value-key="value"
            multiple
            class="w-full"
          />
        </UFormField>
        <UFormField
          label="Series"
          help="Yearly editions share a series, e.g. Ramadan. The catalog shows the newest edition."
        >
          <UInput
            v-model="form.series"
            class="w-full"
          />
        </UFormField>
        <UFormField
          v-if="form.series"
          label="Edition"
          help="Sorts the series, newest first, e.g. 2026."
        >
          <UInput
            v-model="form.edition"
            class="w-full"
          />
        </UFormField>
      </div>
      <template #footer>
        <div class="flex justify-end">
          <UButton
            label="Save details"
            @click="saveMeta"
          />
        </div>
      </template>
    </UCard>

    <UCard>
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="font-semibold">
            Entries
          </h2>
          <div
            v-if="data.canEdit"
            class="flex gap-2"
          >
            <USelect
              v-model="addLanguage"
              :items="(meta?.languages ?? []).filter(l => !languages.includes(l.code)).map(l => ({ value: l.code, label: l.name }))"
              placeholder="Add a language"
              class="w-44"
            />
            <UButton
              icon="i-lucide-plus"
              :label="`Add ${lib.cadence === 'weekly' ? 'week' : 'day'} ${maxDay + 1}`"
              @click="openEntry(maxDay + 1, lib.source_language)"
            />
          </div>
        </div>
      </template>
      <div class="overflow-x-auto">
        <table class="text-sm">
          <thead>
            <tr>
              <th class="p-2 text-start">
                {{ lib.cadence === 'weekly' ? 'Week' : 'Day' }}
              </th>
              <th
                v-for="l in [...languages, ...(addLanguage ? [addLanguage] : [])]"
                :key="l"
                class="p-2 text-start"
              >
                {{ languageName(meta, l) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="d in maxDay"
              :key="d"
              class="border-t border-(--ui-border)"
            >
              <td class="p-2 tabular-nums">
                {{ d }}
              </td>
              <td
                v-for="l in [...languages, ...(addLanguage ? [addLanguage] : [])]"
                :key="l"
                class="p-1"
              >
                <UButton
                  size="xs"
                  :variant="cell(d, l) ? 'soft' : 'ghost'"
                  :color="cell(d, l)?.unpublished ? 'warning' : cell(d, l) ? 'primary' : 'neutral'"
                  :icon="cell(d, l) ? (cell(d, l)?.unpublished ? 'i-lucide-pencil' : 'i-lucide-check') : 'i-lucide-plus'"
                  :aria-label="`Day ${d} ${l}`"
                  :disabled="!data.canEdit && !cell(d, l)"
                  @click="openEntry(d, l)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="text-xs text-(--ui-text-muted) mt-2">
        Orange: draft changes not yet published.
      </p>
    </UCard>

    <UModal
      v-model:open="editor.open"
      :title="`${lib.cadence === 'weekly' ? 'Week' : 'Day'} ${editor.day} · ${languageName(meta, editor.lang)}`"
      :ui="{ content: 'max-w-3xl' }"
    >
      <template #body>
        <PtRichEditor
          v-if="data.canEdit"
          v-model="editor.doc"
          placeholders
          :dir="meta?.languages.find(l => l.code === editor.lang)?.dir"
          min-height="20rem"
        />
        <PtContentView
          v-else
          :doc="editor.published"
        />
      </template>
      <template
        v-if="data.canEdit"
        #footer
      >
        <div class="flex justify-between w-full">
          <UButton
            v-if="editor.lang !== lib.source_language"
            variant="soft"
            icon="i-lucide-languages"
            label="AI translate from source"
            @click="translateEntry"
          />
          <span v-else />
          <UButton
            label="Save draft"
            @click="saveEntry"
          />
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="deleteOpen"
      :title="`Delete “${lib.title}”?`"
    >
      <template #body>
        <UAlert
          v-if="deleteBlocked"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="deleteBlocked"
        />
        <div
          v-else
          class="space-y-2 text-sm"
        >
          <p>The library and all its entries are deleted for good.</p>
          <p
            v-if="data.usage?.copies"
            class="text-(--ui-text-muted)"
          >
            {{ data.usage.copies }} {{ data.usage.copies === 1 ? 'site has' : 'sites have' }} edited their own copy; they keep it as their own content.
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="deleteOpen = false"
          />
          <UButton
            label="Delete library"
            color="error"
            :loading="deleting"
            :disabled="!!deleteBlocked"
            @click="deleteLibrary"
          />
        </div>
      </template>
    </UModal>
    <UModal
      v-model:open="shareOpen"
      title="Share with everyone"
      description="Prayer.Tools reviews the library, including its license, and then publishes it to the catalog for every champion."
    >
      <template #body>
        <UCheckbox
          v-model="rights"
          label="I have the rights to share this content with everyone under the license I chose."
        />
      </template>
      <template #footer>
        <div class="flex justify-end w-full">
          <UButton
            label="Request sharing"
            :disabled="!rights"
            @click="requestShare"
          />
        </div>
      </template>
    </UModal>
    <ShareDialog
      v-model:open="peopleOpen"
      :endpoint="`/api/pt/libraries/${id}/shares`"
      :title="lib.title"
    />
  </div>
</template>
