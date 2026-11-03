<script setup lang="ts">
import type { MarketingVersions } from '../../../../marketing/app/utils/marketing-ui'
import { marketingDate, marketingErrorMessage } from '../../../../marketing/app/utils/marketing-ui'

definePageMeta({ middleware: 'auth', tenantExempt: true })

interface Template { id: string, name: string, versions: MarketingVersions, source_language: string, updated_at: string }

const toast = useToast()
const severalSites = useMarketingSeveralSites()
const templates = ref<Template[]>([])
const loading = ref(true)
const renaming = ref<Template | null>(null)
const name = ref('')

async function load() {
  loading.value = true
  try {
    templates.value = (await $fetch<{ templates: Template[] }>('/api/marketing/templates')).templates
  } catch (err) {
    toast.add({ title: 'Could not load templates', description: marketingErrorMessage(err), color: 'error' })
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function rename() {
  if (!renaming.value) return
  try {
    await $fetch(`/api/marketing/templates/${renaming.value.id}`, { method: 'PUT', body: { name: name.value } })
    renaming.value = null
    await load()
  } catch (err) {
    toast.add({ title: 'Could not rename', description: marketingErrorMessage(err), color: 'error' })
  }
}

async function remove(t: Template) {
  try {
    await $fetch(`/api/marketing/templates/${t.id}`, { method: 'DELETE' })
    await load()
  } catch (err) {
    toast.add({ title: 'Could not delete', description: marketingErrorMessage(err), color: 'error' })
  }
}
</script>

<template>
  <div class="max-w-5xl mx-auto space-y-6">
    <PtLibraryTabs />
    <div class="max-w-3xl space-y-6">
      <div>
        <h1 class="text-2xl font-semibold">
          Your email templates
        </h1>
        <p class="text-sm text-(--ui-text-muted)">
          Templates belong to you and work on any of your sites. Save one from any email with "Save as template"; start a new email from one with "Start from a template".
        </p>
      </div>
      <USkeleton
        v-if="loading"
        class="h-24 w-full"
      />
      <UEmpty
        v-else-if="!templates.length"
        icon="i-lucide-layout-template"
        title="No templates yet"
      />
      <ul
        v-else
        class="divide-y divide-(--ui-border) rounded-lg border border-(--ui-border)"
      >
        <li
          v-for="t in templates"
          :key="t.id"
          class="flex flex-wrap items-center gap-3 p-4"
        >
          <div class="min-w-0 flex-1">
            <p class="font-medium truncate">
              {{ t.name }}
            </p>
            <p class="text-xs text-(--ui-text-muted) truncate">
              {{ t.versions[t.source_language]?.subject }} · {{ Object.keys(t.versions).length }} language(s) · updated {{ marketingDate(t.updated_at) }}
            </p>
          </div>
          <UButton
            v-if="severalSites"
            label="Send to several sites"
            size="sm"
            icon="i-lucide-send"
            color="neutral"
            variant="ghost"
            :to="{ path: '/marketing/multi/new', query: { template: t.id } }"
          />
          <UButton
            label="Rename"
            size="sm"
            color="neutral"
            variant="ghost"
            @click="renaming = t; name = t.name"
          />
          <UButton
            label="Delete"
            size="sm"
            color="error"
            variant="ghost"
            @click="remove(t)"
          />
        </li>
      </ul>
      <UModal
        :open="!!renaming"
        title="Rename template"
        @update:open="v => { if (!v) renaming = null }"
      >
        <template #body>
          <UInput
            v-model="name"
            class="w-full"
            :maxlength="120"
          />
        </template>
        <template #footer>
          <div class="flex justify-end gap-2 w-full">
            <UButton
              label="Cancel"
              color="neutral"
              variant="ghost"
              @click="renaming = null"
            />
            <UButton
              label="Save"
              :disabled="!name.trim()"
              @click="rename"
            />
          </div>
        </template>
      </UModal>
    </div>
  </div>
</template>
