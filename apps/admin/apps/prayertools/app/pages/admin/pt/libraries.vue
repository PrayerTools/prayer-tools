<script setup lang="ts">
// Operators curate platform libraries, review share requests and import
// content packs (pack.json, or a zip with images) into platform libraries:
// choose a file and a target, check the summary, then import.
definePageMeta({ layout: 'admin', middleware: ['auth', 'admin'] })

const { data, refresh } = useFetch<{ requests: Record<string, any>[], platform: Record<string, any>[] }>('/api/pt/admin/libraries', { key: 'pt-admin-libraries' })
const toast = usePtToast()
async function review(id: string, approve: boolean) {
  try {
    await $fetch(`/api/pt/admin/libraries/${id}/review`, { method: 'POST', body: { approve } })
    await refresh()
  } catch (err) {
    toast.fail(err)
  }
}
const newOpen = ref(false)
const form = reactive({ title: '', cadence: 'daily', source_language: 'en', license: 'own', credit: 'Prayer.Tools' })
async function createPlatform() {
  try {
    const res = await $fetch<{ id: string }>('/api/pt/libraries', { method: 'POST', body: { ...form, platform: true } })
    await navigateTo(`/libraries/${res.id}`)
  } catch (err) {
    toast.fail(err)
  }
}
interface PackSummary {
  title: string
  target: { id: string, title: string } | null
  titleMatch: string | null
  days: number
  languages: string[]
  images: number
  added: number
  changed: number
  removed: number
  kept: number
  unchanged: number
  skipped: string[]
}
const { data: meta } = usePtMeta()
const importFile = ref<File | null>(null)
const importTarget = ref('auto')
const publishNow = ref(true)
const summary = ref<PackSummary | null>(null)
const checking = ref(false)
const importing = ref(false)
const targetItems = computed(() => [
  { value: 'new', label: 'A new library' },
  ...(data.value?.platform ?? []).map(l => ({ value: String(l.id), label: `Update “${l.title}”` }))
])

function packForm(confirm: boolean): FormData {
  const form = new FormData()
  form.append('file', importFile.value!)
  form.append('target', importTarget.value)
  if (confirm) {
    form.append('confirm', '1')
    if (publishNow.value) form.append('publish', '1')
  }
  return form
}
async function checkPack() {
  summary.value = null
  if (!importFile.value) return
  checking.value = true
  try {
    const res = await $fetch<{ summary: PackSummary }>('/api/pt/admin/libraries/import', { method: 'POST', body: packForm(false) })
    summary.value = res.summary
    if (importTarget.value === 'auto') importTarget.value = res.summary.target?.id ?? 'new'
  } catch (err) {
    toast.fail(err, 'Can\'t read this pack')
  } finally {
    checking.value = false
  }
}
watch(importFile, () => {
  importTarget.value = 'auto'
  checkPack()
})
watch(importTarget, (t, prev) => {
  if (prev !== 'auto' && t !== 'auto') checkPack()
})
async function importPack() {
  if (!importFile.value || !summary.value) return
  importing.value = true
  try {
    const res = await $fetch<{ id: string, version: number | null, summary: PackSummary }>('/api/pt/admin/libraries/import', { method: 'POST', body: packForm(true) })
    toast.ok(`${res.summary.target ? 'Updated' : 'Created'} “${res.summary.title}”`, res.version ? `Published as version ${res.version}.` : 'Saved as a draft; publish it from the library page.')
    importFile.value = null
    summary.value = null
    await refresh()
  } catch (err) {
    toast.fail(err, 'Import failed')
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">
        Libraries
      </h1>
      <UButton
        icon="i-lucide-plus"
        label="New platform library"
        @click="newOpen = true"
      />
    </div>
    <UCard>
      <template #header>
        <h2 class="font-semibold">
          Share requests
        </h2>
      </template>
      <p
        v-if="!data?.requests.length"
        class="text-sm text-(--ui-text-muted)"
      >
        None waiting.
      </p>
      <div
        v-for="r in data?.requests ?? []"
        :key="r.id"
        class="py-3 border-b border-(--ui-border) last:border-0 flex flex-wrap items-start justify-between gap-3"
      >
        <div class="text-sm">
          <NuxtLink
            :to="`/libraries/${r.id}`"
            class="font-medium hover:underline"
          >
            {{ r.title }}
          </NuxtLink>
          <p class="text-(--ui-text-muted)">
            {{ r.owner_name }} ({{ r.owner_email }}) · {{ r.entry_count }} entries · {{ r.languages.join(', ') }}
          </p>
          <p>License: <strong>{{ PT_LABELS.license[r.license] }}</strong><span v-if="r.license_note"> — {{ r.license_note }}</span> · rights confirmed: {{ r.rights_confirmed ? 'yes' : 'no' }}</p>
        </div>
        <div class="flex gap-2">
          <UButton
            size="sm"
            label="Approve"
            @click="review(r.id, true)"
          />
          <UButton
            size="sm"
            color="neutral"
            variant="soft"
            label="Decline"
            @click="review(r.id, false)"
          />
        </div>
      </div>
    </UCard>
    <UCard>
      <template #header>
        <h2 class="font-semibold">
          Platform libraries
        </h2>
      </template>
      <ul class="text-sm divide-y divide-(--ui-border)">
        <li
          v-for="l in data?.platform ?? []"
          :key="l.id"
          class="py-2 flex justify-between"
        >
          <NuxtLink
            :to="`/libraries/${l.id}`"
            class="hover:underline"
          >{{ l.title }}</NuxtLink>
          <span class="text-(--ui-text-muted)">{{ l.entry_count }} entries · v{{ l.published_version }}</span>
        </li>
      </ul>
    </UCard>
    <UCard>
      <template #header>
        <h2 class="font-semibold">
          Import a content pack
        </h2>
        <p class="text-sm text-(--ui-text-muted)">
          A pack.json, or a zip of pack.json and an images/ folder. The pack's details and entries replace the library's;
          entries not in the pack are removed, except published ones, which sites may follow.
        </p>
      </template>
      <div class="space-y-4">
        <div class="flex flex-wrap items-end gap-3">
          <UFileUpload
            v-model="importFile"
            accept=".zip,.json,application/zip,application/json"
            variant="button"
            label="Choose pack"
          />
          <span
            v-if="importFile"
            class="text-sm self-center"
          >{{ importFile.name }}</span>
          <UFormField
            v-if="importFile"
            label="Import into"
          >
            <USelect
              v-model="importTarget"
              :items="targetItems"
              :placeholder="checking ? 'Checking…' : 'Choose'"
              :disabled="checking"
              class="w-72"
            />
          </UFormField>
        </div>
        <div
          v-if="summary"
          class="rounded-md border border-(--ui-border) p-4 space-y-3 text-sm"
        >
          <p class="font-medium">
            <template v-if="summary.target">
              Updates “{{ summary.target.title }}”<span v-if="summary.target.title !== summary.title"> and renames it “{{ summary.title }}”</span>
            </template>
            <template v-else>
              Creates “{{ summary.title }}”
            </template>
          </p>
          <p class="text-(--ui-text-muted)">
            {{ summary.days }} days · {{ summary.languages.map(l => languageName(meta, l)).join(', ') }}<span v-if="summary.images"> · {{ summary.images }} images</span>
          </p>
          <div class="flex flex-wrap gap-2">
            <UBadge
              :label="`${summary.added} new`"
              color="success"
              variant="subtle"
            />
            <UBadge
              v-if="summary.target"
              :label="`${summary.changed} changed`"
              color="info"
              variant="subtle"
            />
            <UBadge
              v-if="summary.target"
              :label="`${summary.removed} removed`"
              :color="summary.removed ? 'warning' : 'neutral'"
              variant="subtle"
            />
            <UBadge
              v-if="summary.target && summary.kept"
              :label="`${summary.kept} published, kept`"
              color="neutral"
              variant="subtle"
            />
            <UBadge
              v-if="summary.target"
              :label="`${summary.unchanged} unchanged`"
              color="neutral"
              variant="subtle"
            />
          </div>
          <UAlert
            v-if="summary.skipped.length"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :title="`${summary.skipped.length} entries will be skipped`"
            :description="summary.skipped.slice(0, 5).join('; ') + (summary.skipped.length > 5 ? '; …' : '')"
          />
          <UAlert
            v-if="summary.titleMatch && summary.titleMatch !== summary.target?.id"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="Another platform library already has this pack's title."
          />
          <div class="flex flex-wrap items-center justify-between gap-3">
            <UCheckbox
              v-model="publishNow"
              label="Publish now"
              :description="publishNow ? 'Sites using this library get the new version.' : 'Saved as a draft; publish it from the library page.'"
            />
            <UButton
              :label="summary.target ? 'Update library' : 'Create library'"
              icon="i-lucide-upload"
              :loading="importing"
              @click="importPack"
            />
          </div>
        </div>
      </div>
    </UCard>
    <UModal
      v-model:open="newOpen"
      title="New platform library"
    >
      <template #body>
        <div class="space-y-3">
          <UFormField label="Title">
            <UInput
              v-model="form.title"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Cadence">
            <USelect
              v-model="form.cadence"
              :items="[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }]"
              class="w-full"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end w-full">
          <UButton
            label="Create"
            :disabled="form.title.trim().length < 2"
            @click="createPlatform"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
