<script setup lang="ts">
// Paste field reports and get a draft entry, or a series of drafts for the
// following days or weeks, written by AI for the champion to review.
import { MAX_REPORTS, MAX_SERIES } from '@prayertools/shared/prayer-ai'
import type { TiptapDoc } from '@prayertools/shared/db/schema'

interface PtAiDraft { day: number, doc: TiptapDoc }

const props = defineProps<{
  series: boolean
  campaignId?: string
  siteLibraryId: string
  day: number
  lang: string
  unit: string
}>()
const emit = defineEmits<{
  draft: [result: { doc: TiptapDoc, unresolved: string[] }]
  series: [result: { drafts: PtAiDraft[], unresolved: string[] }]
}>()
const open = defineModel<boolean>('open', { default: false })
const toast = usePtToast()

const reports = ref<string[]>([''])
const translation = ref('')
const count = ref(7)
const working = ref(false)

const ready = computed(() => reports.value.some(r => r.trim()))

async function generate() {
  working.value = true
  const body = { campaignId: props.campaignId, siteLibraryId: props.siteLibraryId, day: props.day, lang: props.lang, reports: reports.value, translation: translation.value || undefined }
  try {
    if (props.series) {
      emit('series', await $fetch<{ drafts: PtAiDraft[], unresolved: string[] }>('/api/pt/content/ai/series', { method: 'POST', body: { ...body, count: count.value } }))
    } else {
      emit('draft', await $fetch<{ doc: TiptapDoc, unresolved: string[] }>('/api/pt/content/ai/draft', { method: 'POST', body }))
    }
    reports.value = ['']
    open.value = false
  } catch (err) {
    toast.fail(err, 'Could not write the draft')
  } finally {
    working.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="series ? 'Write a series from reports' : 'Draft from reports'"
    :dismissible="!working"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div class="space-y-4">
        <div
          v-for="(_, i) in reports"
          :key="i"
          class="space-y-1"
        >
          <div class="flex items-center justify-between">
            <label
              :for="`pt-ai-report-${i}`"
              class="text-sm font-medium"
            >
              Report {{ i + 1 }}
              <InfoTip
                v-if="i === 0"
                text="Paste notes or field reports. Names, exact places and organizations are left out of the draft, and you can check it for sensitive details before saving."
              />
            </label>
            <UButton
              v-if="reports.length > 1"
              icon="i-lucide-x"
              size="xs"
              color="neutral"
              variant="ghost"
              :aria-label="`Remove report ${i + 1}`"
              @click="reports.splice(i, 1)"
            />
          </div>
          <UTextarea
            :id="`pt-ai-report-${i}`"
            v-model="reports[i]"
            :rows="5"
            autoresize
            :maxrows="14"
            class="w-full"
          />
        </div>
        <UButton
          v-if="reports.length < MAX_REPORTS"
          icon="i-lucide-plus"
          variant="soft"
          size="sm"
          label="Add another report"
          @click="reports.push('')"
        />
        <div class="flex flex-wrap gap-4">
          <UFormField v-if="series">
            <template #label>
              Entries <InfoTip :text="`Drafts for ${unit} ${day} and the ${unit}s after it. Each opens in the editor for you to review and save.`" />
            </template>
            <UInputNumber
              v-model="count"
              :min="2"
              :max="MAX_SERIES"
            />
          </UFormField>
          <UFormField>
            <template #label>
              Bible translation <InfoTip text="Scripture is suggested as references and its text is looked up in this translation. AI never writes Scripture." />
            </template>
            <UInput
              v-model="translation"
              placeholder="NIV"
              class="w-24"
            />
          </UFormField>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          :disabled="working"
          @click="open = false"
        />
        <UButton
          icon="i-lucide-sparkles"
          :label="series ? `Write ${count} drafts` : 'Write a draft'"
          :loading="working"
          :disabled="!ready"
          @click="generate"
        />
      </div>
    </template>
  </UModal>
</template>
