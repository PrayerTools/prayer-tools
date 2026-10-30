<script setup lang="ts">
// One campaign: its numbers, setup answers, address, place and people group,
// and end-of-campaign message. Opening it makes it the campaign the other campaign pages edit.
import type { PtCampaign } from '../../../utils/pt-campaign-ui'

definePageMeta({ middleware: 'auth' })

const route = useRoute()
const id = computed(() => String(route.params.id))
const { data: site, can, slug } = usePtSite()
const toast = usePtToast()
const { select } = usePtCampaign()
watch(id, v => select(v), { immediate: true })
const { data, refresh } = useFetch<{ campaign: PtCampaign & { entries: number | null, contentEntries: number, usesPlaceWording: boolean }, libraries: { siteLibraryId: string, title: string, entryCount: number }[] }>(() => `/api/pt/campaigns/${id.value}`, { key: computed(() => `pt-campaign-${id.value}`) })

const { draft, fillFrom, toBody } = usePtCampaignDraft()
const slugField = ref('')
// The form starts from the saved campaign when it opens and after it is saved;
// other refreshes (the thank-you message, ending it) keep unsaved edits.
function loadForm() {
  const c = data.value?.campaign
  if (!c) return
  fillFrom(c)
  slugField.value = c.slug
}
watch(() => data.value?.campaign.id, loadForm, { immediate: true })

const campaignUrl = computed(() => site.value ? `${site.value.url}/${data.value?.campaign.slug}` : '')
const serving = computed(() => !!data.value && site.value?.currentCampaign?.id === data.value.campaign.id)
const goalText = computed(() => data.value ? ptGoalText(data.value.campaign.progress) : null)
const contentShort = computed(() => {
  const c = data.value?.campaign
  return !!c?.entries && c.contentEntries < c.entries
})
const answersChanged = computed(() => {
  const c = data.value?.campaign
  if (!c) return false
  return (['start_mode', 'end_mode', 'goal', 'cadence'] as const).some(k => draft.value.setup[k] !== c[k])
})

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    await $fetch(`/api/pt/campaigns/${id.value}`, {
      method: 'PATCH',
      body: { ...toBody(), slug: slugField.value }
    })
    await refresh()
    loadForm()
    toast.ok('Campaign saved')
  } catch (err) {
    toast.fail(err)
  } finally {
    saving.value = false
  }
}

const confirmDelete = ref(false)
async function remove() {
  try {
    await $fetch(`/api/pt/campaigns/${id.value}`, { method: 'DELETE' })
    await navigateTo(`/@${slug.value}/site/campaigns`)
  } catch (err) {
    toast.fail(err, 'Could not delete')
  }
}
</script>

<template>
  <div
    v-if="data && site"
    class="max-w-6xl mx-auto space-y-8"
  >
    <div class="flex flex-wrap items-start justify-between gap-6 rounded-lg bg-[#202833] p-6 sm:p-8 text-white">
      <div class="min-w-0">
        <UButton
          :to="`/@${slug}/site/campaigns`"
          icon="i-lucide-arrow-left"
          variant="link"
          color="neutral"
          label="Campaigns"
          class="px-0 text-slate-200 hover:text-white mb-3"
        />
        <div class="flex items-center gap-2 flex-wrap">
          <h1 class="text-2xl font-bold">
            {{ data.campaign.name }}
          </h1>
          <UBadge
            v-if="!data.campaign.published_at"
            label="Draft"
            color="neutral"
            variant="subtle"
          />
          <UBadge
            v-else
            :label="PT_LABELS.campaignStatus[data.campaign.status]"
            :color="ptStatusColor(data.campaign.status)"
            variant="subtle"
          />
          <UBadge
            v-if="serving"
            color="primary"
            variant="outline"
            label="Featured on your site"
          />
          <UBadge
            v-if="data.campaign.kind === 'side'"
            color="neutral"
            variant="outline"
            label="Side campaign"
          />
        </div>
        <p class="mt-3 text-sm text-slate-200">
          {{ ptCampaignDates(data.campaign) }}
        </p>
        <p class="text-sm text-slate-300 mt-2">
          {{ ptAnswersLine(data.campaign) }}
        </p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <UButton
          :to="`/@${slug}/site/landing`"
          variant="soft"
          color="neutral"
          icon="i-lucide-panels-top-left"
          label="Landing page"
        />
        <UButton
          :to="campaignUrl"
          target="_blank"
          size="lg"
          icon="i-lucide-external-link"
          label="View on the site"
        />
        <UButton
          :to="`${campaignUrl}/stats`"
          target="_blank"
          variant="soft"
          color="neutral"
          icon="i-lucide-chart-line"
          label="Public results"
        />
      </div>
    </div>

    <UAlert
      v-if="!data.campaign.published_at"
      icon="i-lucide-list-checks"
      color="neutral"
      variant="subtle"
      title="This campaign is a draft"
      description="It is not on your site yet. Add its prayer content and landing page, then publish it."
      :actions="can('pt.campaigns.write') ? [{ label: 'Continue setup', to: `/@${slug}/site/campaigns/setup/${id}`, trailingIcon: 'i-lucide-arrow-right' }] : []"
    />

    <div class="space-y-1">
      <h2 class="text-xl font-semibold">
        Campaign overview
      </h2>
      <p class="text-sm text-(--ui-text-muted)">
        Participation, goal progress, and prayer-guide readiness.
      </p>
    </div>

    <div class="grid gap-4 md:grid-cols-3">
      <UCard>
        <div class="space-y-1">
          <p class="text-sm text-muted">
            People signed up
          </p>
          <p class="text-3xl font-bold">
            {{ data.campaign.progress.people.toLocaleString() }}
          </p>
          <p class="text-xs text-muted">
            {{ ptPlural(data.campaign.commitments, 'prayer time', 'prayer times') }}
          </p>
        </div>
      </UCard>
      <UCard>
        <div class="space-y-2">
          <p class="text-sm text-muted">
            {{ PT_LABELS.goal[data.campaign.goal] }}
          </p>
          <template v-if="data.campaign.progress.percent !== null">
            <p class="text-3xl font-bold">
              {{ data.campaign.progress.percent }}%
            </p>
            <UProgress
              :model-value="Math.min(100, data.campaign.progress.percent)"
              size="sm"
            />
          </template>
          <p
            v-if="goalText"
            class="text-xs text-muted"
          >
            {{ goalText }}
          </p>
          <p
            v-else
            class="text-xs text-muted"
          >
            No target set.
          </p>
        </div>
      </UCard>
      <UCard>
        <div class="space-y-1">
          <p class="text-sm text-muted">
            Prayer content
          </p>
          <p class="text-3xl font-bold">
            {{ data.campaign.contentEntries }}
          </p>
          <p class="text-xs text-muted">
            {{ data.campaign.entries ? `of ${data.campaign.entries} ${data.campaign.cadence === 'weekly' ? 'weeks' : 'days'}` : 'entries' }}
          </p>
          <UButton
            :to="{ path: `/@${slug}/site/content`, query: { campaign: id } }"
            size="xs"
            variant="link"
            icon="i-lucide-book-open"
            label="Edit content"
            class="px-0"
          />
        </div>
      </UCard>
    </div>

    <UAlert
      v-if="data.campaign.kind === 'side'"
      color="neutral"
      variant="subtle"
      icon="i-lucide-split"
      title="Runs alongside your main campaign"
      :description="`It has its own address and landing page, ${campaignUrl.replace(/^https?:\/\//, '')}. While it is upcoming or running, your home page links to it.`"
    />

    <UAlert
      v-if="contentShort"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Some days have no prayer content yet"
      :description="`The campaign has ${data.campaign.entries} ${data.campaign.cadence === 'weekly' ? 'weeks' : 'days'} and ${data.campaign.contentEntries} content entries.`"
      :actions="[{ label: 'Add content', to: { path: `/@${slug}/site/content`, query: { campaign: id } }, trailingIcon: 'i-lucide-arrow-right' }]"
    />

    <UCard>
      <template #header>
        <h2 class="text-lg font-semibold">
          Campaign details
        </h2>
        <p class="mt-1 text-sm text-(--ui-text-muted)">
          Update the name, dates, and prayer goals for this campaign.
        </p>
      </template>
      <div class="space-y-6">
        <UAlert
          v-if="!can('pt.campaigns.write')"
          color="neutral"
          variant="subtle"
          icon="i-lucide-lock"
          title="Only owners and editors can change the campaign."
        />
        <UAlert
          v-if="data.campaign.progress.people > 0 && answersChanged"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="This affects people who already signed up"
          :description="`${data.campaign.progress.people.toLocaleString()} ${data.campaign.progress.people === 1 ? 'person has' : 'people have'} signed up. Changing how the campaign starts, ends or counts changes which prayer content they see, what their reminders ask and how progress is shown.`"
        />
        <PtCampaignFields
          v-model="draft"
          :dated="data.campaign.kind === 'side'"
          :with-place-wording="data.campaign.usesPlaceWording"
          :languages="site.site.languages"
          :disabled="!can('pt.campaigns.write')"
        >
          <template #after-name>
            <UFormField
              label="Address"
              :help="`${site.url.replace(/^https?:\/\//, '')}/${slugField}`"
              class="py-6"
            >
              <UInput
                v-model="slugField"
                size="lg"
                class="w-full sm:w-80 font-mono"
              />
            </UFormField>
          </template>
        </PtCampaignFields>
      </div>
      <template
        v-if="can('pt.campaigns.write')"
        #footer
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex gap-2">
            <UButton
              v-if="data.campaign.commitments === 0"
              color="error"
              variant="ghost"
              icon="i-lucide-trash-2"
              label="Delete"
              @click="confirmDelete = true"
            />
          </div>
          <UButton
            icon="i-lucide-save"
            label="Save changes"
            size="lg"
            :loading="saving"
            @click="save"
          />
        </div>
      </template>
    </UCard>

    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon
            name="i-lucide-mail"
            class="size-5 text-primary"
          />
          <h2 class="text-lg font-semibold">
            Thank-you message
          </h2>
        </div>
        <p class="mt-2 text-sm text-(--ui-text-muted)">
          Prepare the message people receive when this campaign ends.
        </p>
      </template>
      <PtCampaignThankYou
        :key="data.campaign.id"
        :campaign-id="data.campaign.id"
        :end-message="data.campaign.end_message"
        :cta="data.campaign.cta"
        :languages="site.site.languages"
        :default-language="site.site.default_language"
        @saved="refresh"
      />
    </UCard>

    <UModal
      v-model:open="confirmDelete"
      title="Delete this campaign?"
      description="Nobody has signed up for it yet. Its setup and thank-you message are deleted too."
    >
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="confirmDelete = false"
          />
          <UButton
            label="Delete campaign"
            color="error"
            @click="remove"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
