<script setup lang="ts">
// A campaign's prayer content while it is set up: how often there is new
// content, how many entries each person goes through (personal-start
// campaigns without an end), what is in the campaign, and adding a library or
// content of one's own. Emits `changed` after the campaign itself is saved.
import type { SetupState } from './PtSetupForm.vue'

const props = defineProps<{
  campaign: { id: string, cadence: SetupState['cadence'], start_mode: string, end_mode: string, length_days: number | null }
  templateKey: string
}>()
const emit = defineEmits<{ changed: [] }>()

const { data: site } = usePtSite()
const { data: meta } = usePtMeta()
const toast = usePtToast()

const { data: content, refresh: refreshContent } = useFetch<{ libraries: { siteLibraryId: string, libraryId: string | null, title: string, entryCount: number, missingLanguages: string[] }[] }>('/api/pt/content', {
  query: computed(() => ({ campaign: props.campaign.id })),
  key: computed(() => `pt-setup-content-${props.campaign.id}`)
})
async function useLibrary(libraryId: string) {
  try {
    await $fetch('/api/pt/content/libraries', { method: 'POST', body: { campaignId: props.campaign.id, libraryId } })
    await refreshContent()
    toast.ok('Added to your campaign')
  } catch (err) {
    toast.fail(err)
  }
}

const cadence = ref(props.campaign.cadence)
watch(() => props.campaign.cadence, (c) => {
  cadence.value = c
})
const cadenceOpen = computed(() => {
  if (!meta.value) return false
  const t = meta.value.templates.find(x => x.key === props.templateKey)
  return !t || t.open.includes('cadence')
})
const savingCadence = ref(false)
async function saveCadence(next: SetupState['cadence']) {
  cadence.value = next
  savingCadence.value = true
  try {
    await $fetch(`/api/pt/campaigns/${props.campaign.id}`, { method: 'PATCH', body: { cadence: next } })
    emit('changed')
  } catch (err) {
    toast.fail(err)
  } finally {
    savingCadence.value = false
  }
}
// Personal-start campaigns without a length go through all of their content.
const contentEntries = computed(() => Math.max(0, ...(content.value?.libraries ?? []).map(l => l.entryCount)))
const lengthOpen = computed(() => props.campaign.start_mode === 'join' && props.campaign.end_mode === 'days')
async function saveLength(length: number | null | undefined) {
  try {
    await $fetch(`/api/pt/campaigns/${props.campaign.id}`, { method: 'PATCH', body: { length_days: length ?? null } })
    emit('changed')
  } catch (err) {
    toast.fail(err)
  }
}
const ownTitle = ref('')
async function createOwn() {
  try {
    await $fetch('/api/pt/content/libraries', { method: 'POST', body: { campaignId: props.campaign.id, title: ownTitle.value || 'Our prayer guide' } })
    ownTitle.value = ''
    await refreshContent()
    toast.ok('Created. Write the entries on the Prayer content page.')
  } catch (err) {
    toast.fail(err)
  }
}
</script>

<template>
  <div class="divide-y divide-(--ui-border-accented)">
    <UFormField
      label="How often is there new prayer content?"
      :help="!cadenceOpen ? 'Set by the template.' : undefined"
      :ui="{ label: 'text-base font-semibold' }"
      class="py-6 first:pt-0 last:pb-0"
    >
      <URadioGroup
        :model-value="cadence"
        :items="PT_CADENCE_ITEMS"
        orientation="horizontal"
        variant="card"
        :disabled="!cadenceOpen || savingCadence"
        @update:model-value="(v) => saveCadence(v as SetupState['cadence'])"
      />
    </UFormField>
    <UFormField
      v-if="lengthOpen"
      :label="`How many ${ptUnit(cadence)}s does each person go through? (optional)`"
      :help="contentEntries ? `Leave empty to go through all ${contentEntries} entries.` : 'Leave empty to go through all of the prayer content.'"
      :ui="{ label: 'text-base font-semibold' }"
      class="py-6 first:pt-0 last:pb-0"
    >
      <UInputNumber
        :model-value="campaign.length_days"
        :min="1"
        :max="contentEntries || 3650"
        placeholder="All"
        @update:model-value="saveLength"
      />
    </UFormField>
    <section
      v-if="content?.libraries.length"
      class="space-y-2 py-6 first:pt-0 last:pb-0"
    >
      <h3 class="text-base font-semibold">
        In your campaign
      </h3>
      <div
        v-for="l in content.libraries"
        :key="l.siteLibraryId"
        class="flex items-center justify-between rounded-md border border-(--ui-border) px-3 py-2 text-sm"
      >
        <span>{{ l.title }} · {{ l.entryCount }} entries</span>
        <UBadge
          v-if="l.missingLanguages.length"
          color="warning"
          variant="soft"
          :label="`Missing: ${l.missingLanguages.map(x => languageName(meta, x)).join(', ')}`"
        />
      </div>
    </section>
    <section class="space-y-4 py-6 first:pt-0 last:pb-0">
      <h3 class="text-base font-semibold">
        Add prayer content
      </h3>
      <PtLibraryCatalog
        :template="templateKey"
        :cadence="cadence"
        :site-languages="site?.site.languages ?? []"
        :used-ids="(content?.libraries ?? []).map(l => l.libraryId).filter(Boolean) as string[]"
        @use="useLibrary"
      />
      <USeparator label="or" />
      <div class="flex flex-wrap items-end gap-2">
        <UFormField
          label="Write your own content"
          class="flex-1"
        >
          <UInput
            v-model="ownTitle"
            placeholder="Our prayer guide"
            class="w-full"
          />
        </UFormField>
        <UButton
          label="Create"
          variant="soft"
          @click="createOwn"
        />
      </div>
    </section>
  </div>
</template>
