<script setup lang="ts">
// The champion's own campaign templates, saved from a campaign with "Save as
// template", and those shared with them. New campaigns on any of their sites
// can start from one.
import type { PersonalTemplateSetup } from '@prayertools/shared/db/schema'

definePageMeta({ middleware: 'auth', tenantExempt: true })

interface Template { id: string, name: string, template_key: string | null, setup: PersonalTemplateSetup, libraries: number, updated_at: string, role: 'owner' | 'editor' | 'viewer', owner_name: string }

const toast = usePtToast()
const { data, refresh, status } = useFetch<{ templates: Template[] }>('/api/pt/campaign-templates', { key: 'pt-campaign-templates' })
const view = ref<'mine' | 'shared'>('mine')
const viewItems = [{ label: 'Mine', value: 'mine' }, { label: 'Shared with me', value: 'shared' }]
const shown = computed(() => (data.value?.templates ?? []).filter(t => (view.value === 'mine') === (t.role === 'owner')))

function summary(t: Template): string {
  const s = t.setup
  const length = s.length_days ? ptPlural(s.length_days, ptUnit(s.cadence ?? 'daily'), `${ptUnit(s.cadence ?? 'daily')}s`) : null
  return [
    s.start_mode === 'join' ? 'Starts when each person joins' : 'Starts on a date',
    length ?? (s.end_mode === 'none' ? 'No end' : null),
    s.goal ? PT_LABELS.goal[s.goal] : null,
    ptPlural(t.libraries, 'library', 'libraries')
  ].filter(Boolean).join(' · ')
}

const renaming = ref<Template | null>(null)
const name = ref('')
async function rename() {
  if (!renaming.value) return
  try {
    await $fetch(`/api/pt/campaign-templates/${renaming.value.id}`, { method: 'PATCH', body: { name: name.value } })
    renaming.value = null
    await refresh()
  } catch (err) {
    toast.fail(err, 'Could not rename')
  }
}

const confirmAction = useConfirm()
async function remove(t: Template) {
  if (!await confirmAction({ title: `Delete “${t.name}”?`, confirmLabel: 'Delete' })) return
  try {
    await $fetch(`/api/pt/campaign-templates/${t.id}`, { method: 'DELETE' })
    await refresh()
  } catch (err) {
    toast.fail(err, 'Could not delete')
  }
}

const sharing = ref<Template | null>(null)
function sharingClosed(open: boolean) {
  if (open) return
  sharing.value = null
  refresh()
}
</script>

<template>
  <div class="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
    <PtLibraryTabs />
    <div>
      <h1 class="text-2xl font-semibold">
        Your campaign templates <InfoTip text="Save one from any campaign with “Save as template”. It keeps the campaign's answers, landing page, hero image, end-of-campaign message, call to action and libraries; a new campaign on any of your sites can start from it." />
      </h1>
    </div>
    <UTabs
      v-model="view"
      :items="viewItems"
      :content="false"
      size="sm"
      class="w-fit"
    />
    <USkeleton
      v-if="status === 'pending' && !data"
      class="h-24 w-full"
    />
    <UEmpty
      v-else-if="!shown.length"
      icon="i-lucide-bookmark"
      :title="view === 'mine' ? 'No campaign templates yet' : 'No campaign templates shared with you'"
    />
    <ul
      v-else
      class="divide-y divide-(--ui-border) rounded-lg border border-(--ui-border)"
    >
      <li
        v-for="t in shown"
        :key="t.id"
        class="flex flex-wrap items-center gap-3 p-4"
      >
        <div class="min-w-0 flex-1">
          <p class="font-medium truncate">
            {{ t.name }}
          </p>
          <p class="text-xs text-(--ui-text-muted) truncate">
            {{ summary(t) }}
          </p>
          <p
            v-if="t.role !== 'owner'"
            class="text-xs text-(--ui-text-muted)"
          >
            From {{ t.owner_name }} · {{ t.role === 'editor' ? 'Can edit' : 'Can view' }}
          </p>
        </div>
        <UButton
          :label="t.role === 'owner' ? 'Share' : 'Sharing'"
          size="sm"
          icon="i-lucide-users"
          color="neutral"
          variant="ghost"
          @click="sharing = t"
        />
        <UButton
          v-if="t.role !== 'viewer'"
          label="Rename"
          size="sm"
          color="neutral"
          variant="ghost"
          @click="renaming = t; name = t.name"
        />
        <UButton
          v-if="t.role === 'owner'"
          label="Delete"
          size="sm"
          color="error"
          variant="ghost"
          @click="remove(t)"
        />
      </li>
    </ul>
    <ShareDialog
      :open="!!sharing"
      :endpoint="`/api/pt/campaign-templates/${sharing?.id}/shares`"
      :title="sharing?.name"
      @update:open="sharingClosed"
    />
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
            :disabled="name.trim().length < 2"
            @click="rename"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
