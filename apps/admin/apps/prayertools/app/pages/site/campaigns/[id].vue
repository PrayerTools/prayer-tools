<script setup lang="ts">
// One campaign: its numbers, setup answers, address and end-of-campaign
// message; a side campaign also links to its own landing page.
import type { SetupState } from '../../../components/PtSetupForm.vue'
import type { PtCampaign } from '../../../utils/pt-campaign-ui'

definePageMeta({ middleware: 'auth' })

const route = useRoute()
const id = computed(() => String(route.params.id))
const { data: site, can } = usePtSite()
const toast = usePtToast()
const { data, refresh } = useFetch<{ campaign: PtCampaign & { entries: number | null, contentEntries: number }, libraries: { siteLibraryId: string, title: string, entryCount: number }[] }>(() => `/api/pt/campaigns/${id.value}`, { key: computed(() => `pt-campaign-${id.value}`) })

const form = reactive({ name: '', slug: '', timezone: 'UTC' })
const setup = ref<SetupState>({ start_mode: 'date', start_date: null, end_mode: 'date', end_date: null, length_days: null, goal: 'people', cadence: 'daily', track_time: false, goal_target: null, slot_min: null })
watch(data, (d) => {
  const c = d?.campaign
  if (!c) return
  form.name = c.name
  form.slug = c.slug
  form.timezone = c.timezone
  setup.value = { start_mode: c.start_mode, start_date: c.start_date, end_mode: c.end_mode, end_date: c.end_date, length_days: c.length_days, goal: c.goal, cadence: c.cadence, track_time: c.track_time, goal_target: c.goal_target, slot_min: c.slot_min ?? null }
}, { immediate: true })

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
  return (['start_mode', 'end_mode', 'goal', 'cadence'] as const).some(k => setup.value[k] !== c[k])
})

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    await $fetch(`/api/pt/campaigns/${id.value}`, {
      method: 'PATCH',
      body: { ...form, ...setup.value }
    })
    await refresh()
    toast.ok('Campaign saved')
  } catch (err) {
    toast.fail(err)
  } finally {
    saving.value = false
  }
}

const confirmClose = ref(false)
const confirmDelete = ref(false)
async function close() {
  try {
    await $fetch(`/api/pt/campaigns/${id.value}/close`, { method: 'POST' })
    confirmClose.value = false
    await refresh()
    toast.ok('Campaign ended', 'Everyone in it will get the thank-you email.')
  } catch (err) {
    toast.fail(err)
  }
}
async function remove() {
  try {
    await $fetch(`/api/pt/campaigns/${id.value}`, { method: 'DELETE' })
    await navigateTo('/site/campaigns')
  } catch (err) {
    toast.fail(err, 'Could not delete')
  }
}
</script>

<template>
  <div
    v-if="data && site"
    class="max-w-4xl mx-auto space-y-6"
  >
    <PtCampaignTabs :campaign-id="id" />
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0">
        <UButton
          to="/site/campaigns"
          icon="i-lucide-arrow-left"
          variant="link"
          color="neutral"
          label="Campaigns"
          class="px-0"
        />
        <div class="flex items-center gap-2 flex-wrap">
          <h1 class="text-2xl font-bold">
            {{ data.campaign.name }}
          </h1>
          <UBadge
            :label="PT_LABELS.campaignStatus[data.campaign.status]"
            :color="ptStatusColor(data.campaign.status)"
            variant="subtle"
          />
          <UBadge
            v-if="serving"
            color="primary"
            variant="outline"
            label="On the site now"
          />
          <UBadge
            v-if="data.campaign.kind === 'side'"
            color="neutral"
            variant="outline"
            label="Side campaign"
          />
        </div>
        <p class="text-sm text-muted">
          {{ ptCampaignDates(data.campaign) }}
        </p>
        <p class="text-xs text-muted mt-1">
          {{ ptAnswersLine(data.campaign) }}
        </p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <UButton
          v-if="data.campaign.kind === 'side'"
          :to="{ path: '/site/landing', query: { campaign: id } }"
          variant="outline"
          color="neutral"
          icon="i-lucide-panels-top-left"
          label="Landing page"
        />
        <UButton
          :to="campaignUrl"
          target="_blank"
          variant="outline"
          color="neutral"
          icon="i-lucide-external-link"
          label="View on the site"
        />
        <UButton
          :to="`${campaignUrl}/stats`"
          target="_blank"
          variant="ghost"
          color="neutral"
          icon="i-lucide-chart-line"
          label="Public results"
        />
      </div>
    </header>

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
            :to="{ path: '/site/content', query: { campaign: id } }"
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
      :actions="[{ label: 'Add content', to: { path: '/site/content', query: { campaign: id } }, trailingIcon: 'i-lucide-arrow-right' }]"
    />

    <UCard>
      <template #header>
        <h2 class="font-semibold">
          Setup
        </h2>
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
        <fieldset
          :disabled="!can('pt.campaigns.write')"
          class="space-y-6"
        >
          <div class="grid sm:grid-cols-2 gap-4">
            <UFormField label="Name">
              <UInput
                v-model="form.name"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Address"
              :help="`${site.url.replace(/^https?:\/\//, '')}/${form.slug}`"
            >
              <UInput
                v-model="form.slug"
                class="w-full font-mono"
              />
            </UFormField>
          </div>
          <UFormField
            label="Timezone"
            help="Campaign days begin at midnight here."
          >
            <USelectMenu
              v-model="form.timezone"
              :items="ptTimezones()"
              class="w-full sm:w-80"
            />
          </UFormField>
          <PtSetupForm
            v-model="setup"
            :template-key="data.campaign.template_key ?? 'generic'"
            :lock-template="false"
            :dated="data.campaign.kind === 'side'"
          />
        </fieldset>
      </div>
      <template
        v-if="can('pt.campaigns.write')"
        #footer
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex gap-2">
            <UButton
              v-if="data.campaign.status !== 'ended'"
              color="neutral"
              variant="outline"
              icon="i-lucide-square"
              label="End early"
              @click="confirmClose = true"
            />
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
            icon="i-lucide-check"
            label="Save"
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
          <h2 class="font-semibold">
            Thank-you message
          </h2>
        </div>
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
      v-model:open="confirmClose"
      title="End this campaign early?"
      description="Yesterday becomes its last day. The site shows the final results and invites people to be notified when it runs again. Everyone in the campaign gets the thank-you email."
    >
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="confirmClose = false"
          />
          <UButton
            label="End campaign"
            color="warning"
            @click="close"
          />
        </div>
      </template>
    </UModal>

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
