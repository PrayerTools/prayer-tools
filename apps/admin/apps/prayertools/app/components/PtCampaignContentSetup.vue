<script setup lang="ts">
// A campaign's prayer content while it is set up: how often there is new
// content, how many entries each person goes through (personal-start
// campaigns without an end), what is in the campaign, and adding a library or
// content of one's own. Emits `changed` after the campaign itself is saved,
// and `added` after a library is added. The `after-libraries` slot follows
// the campaign's content.
// `save()` adds the campaign's own content when that is the choice; the
// wizard calls it on Continue.
import type { SetupState } from './PtSetupForm.vue'

const props = defineProps<{
  campaign: { id: string, cadence: SetupState['cadence'], start_mode: string, end_mode: string, length_days: number | null }
  templateKey: string
}>()
const emit = defineEmits<{ changed: [], added: [] }>()

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
    emit('added')
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
const writeUrl = computed(() => `/site/content?campaign=${props.campaign.id}`)
const hasOwn = computed(() => (content.value?.libraries ?? []).some(l => !l.libraryId))
const source = ref<'existing' | 'own'>('existing')
watch(hasOwn, (own) => {
  if (own) source.value = 'own'
}, { immediate: true })
async function save(): Promise<boolean> {
  if (source.value !== 'own' || hasOwn.value) return true
  try {
    await $fetch('/api/pt/content/libraries', { method: 'POST', body: { campaignId: props.campaign.id } })
    await refreshContent()
    return true
  } catch (err) {
    toast.fail(err)
    return false
  }
}
defineExpose({ save })
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
        <span>{{ l.libraryId ? l.title : 'Your own content' }} · {{ l.entryCount }} entries</span>
        <div
          v-if="!l.entryCount"
          class="flex items-center gap-2"
        >
          <UBadge
            color="warning"
            variant="soft"
            label="Not written yet"
          />
          <UButton
            :to="writeUrl"
            size="xs"
            variant="link"
            label="Write entries"
          />
        </div>
        <UBadge
          v-else-if="l.missingLanguages.length"
          color="warning"
          variant="soft"
          :label="`Missing: ${l.missingLanguages.map(x => languageName(meta, x)).join(', ')}`"
        />
      </div>
    </section>
    <slot name="after-libraries" />
    <section class="space-y-4 py-6 first:pt-0 last:pb-0">
      <h3 class="text-base font-semibold">
        Add prayer content
      </h3>
      <URadioGroup
        v-model="source"
        :items="[
          { label: 'Choose from existing content', description: 'Use a prayer guide from the library.', value: 'existing' },
          { label: 'Write my own content', description: 'Write the entries yourself.', value: 'own' }
        ]"
        orientation="horizontal"
        variant="card"
      />
      <PtLibraryCatalog
        v-if="source === 'existing'"
        :template="templateKey"
        :cadence="cadence"
        :site-languages="site?.site.languages ?? []"
        :used-ids="(content?.libraries ?? []).map(l => l.libraryId).filter(Boolean) as string[]"
        @use="useLibrary"
      />
      <p
        v-else
        class="text-sm text-(--ui-text-muted)"
      >
        You will create the campaign content after setting up the campaign.
      </p>
    </section>
  </div>
</template>
