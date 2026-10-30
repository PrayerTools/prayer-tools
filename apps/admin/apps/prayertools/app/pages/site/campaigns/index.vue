<script setup lang="ts">
// The site's campaigns, grouped by state, each with its dates, setup answers,
// people and prayer times, and the actions that fit its state.
import type { PtCampaign } from '../../../utils/pt-campaign-ui'

definePageMeta({ middleware: 'auth' })

const { data: site, can, slug } = usePtSite()
const toast = usePtToast()
const { data, status, refresh } = usePtCampaignList()
const canEdit = computed(() => can('pt.campaigns.write'))

const groups = computed(() => {
  const list = data.value?.campaigns ?? []
  return (['active', 'upcoming', 'ended'] as const)
    .map(state => ({ state, items: list.filter(c => c.status === state) }))
    .filter(g => g.items.length)
})
// A running main campaign with no end date holds every future date, so only a side campaign fits until it is ended.
const blocker = computed(() => data.value?.campaigns.find(c => c.kind !== 'side' && c.status === 'active' && c.end_mode !== 'date') ?? null)
const blockedOpen = ref(false)
const serving = (c: PtCampaign) => site.value?.currentCampaign?.id === c.id
const resultsUrl = (c: PtCampaign) => site.value ? `${site.value.url}/${c.slug}/stats` : undefined

const expanded = ref<string | null>(null)

const confirm = reactive({ open: false, campaign: null as PtCampaign | null })
function askDelete(c: PtCampaign) {
  Object.assign(confirm, { open: true, campaign: c })
}
const confirming = ref(false)
async function doConfirm() {
  if (!confirm.campaign) return
  confirming.value = true
  try {
    await $fetch(`/api/pt/campaigns/${confirm.campaign.id}`, { method: 'DELETE' })
    toast.ok('Campaign deleted')
    confirm.open = false
    await refresh()
  } catch (err) {
    toast.fail(err, 'Could not delete the campaign')
  } finally {
    confirming.value = false
  }
}
</script>

<template>
  <div class="max-w-6xl mx-auto space-y-8">
    <div class="flex items-start justify-between gap-6 flex-wrap rounded-lg bg-[#202833] p-6 sm:p-8 text-white">
      <div>
        <p class="mb-3 text-xs font-semibold uppercase tracking-widest text-orange-300">
          Manage your campaigns
        </p>
        <h1 class="text-2xl font-bold">
          Campaigns
        </h1>
        <p class="mt-3 text-sm leading-relaxed text-slate-200 max-w-xl">
          A campaign is one round of prayer on your site, like Ramadan 2026. Each has its own dates and setup.
          A site runs one main campaign at a time, so main campaign dates can't overlap.
          A side campaign, like Ramadan beside an ongoing campaign, runs alongside it at its own address with its own landing page.
          Relaunching creates a new campaign on the same site; past campaigns stay online with their results.
        </p>
      </div>
      <UButton
        v-if="canEdit"
        :to="blocker ? undefined : `/@${slug}/site/campaigns/new`"
        size="lg"
        icon="i-lucide-plus"
        :label="data?.campaigns.length ? 'New campaign' : 'Create the first campaign'"
        @click="blockedOpen = !!blocker"
      />
    </div>

    <div
      v-if="status === 'pending' && !data"
      class="space-y-3"
    >
      <USkeleton class="h-32" />
      <USkeleton class="h-32" />
    </div>

    <UCard v-else-if="!data?.campaigns.length">
      <p class="text-sm text-muted">
        No campaigns yet. Create one to set its dates, goal and how often there is new prayer content.
      </p>
    </UCard>

    <section
      v-for="g in groups"
      :key="g.state"
      class="space-y-3"
    >
      <h2 class="text-lg font-semibold flex items-center gap-3">
        {{ PT_LABELS.campaignStatus[g.state] }}
        <UBadge
          color="neutral"
          variant="soft"
          :label="String(g.items.length)"
        />
      </h2>
      <UCard
        v-for="c in g.items"
        :key="c.id"
        class="rounded-lg"
      >
        <div class="space-y-5">
          <div class="flex items-start justify-between gap-3 flex-wrap">
            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <NuxtLink
                  :to="`/@${slug}/site/campaigns/${c.id}`"
                  class="text-xl font-semibold hover:underline"
                >
                  {{ c.name }}
                </NuxtLink>
                <UBadge
                  v-if="!c.published_at"
                  color="neutral"
                  variant="subtle"
                  label="Draft"
                />
                <UBadge
                  v-else
                  :color="ptStatusColor(c.status)"
                  variant="subtle"
                  :label="PT_LABELS.campaignStatus[c.status]"
                />
                <UBadge
                  v-if="serving(c)"
                  color="primary"
                  variant="outline"
                  label="Featured on your site"
                />
                <UBadge
                  v-if="c.kind === 'side'"
                  color="neutral"
                  variant="outline"
                  label="Side campaign"
                />
              </div>
              <p class="mt-3 text-sm font-medium">
                {{ ptCampaignDates(c) }}
              </p>
              <p class="text-sm text-muted mt-2">
                {{ ptAnswersLine(c) }}
              </p>
            </div>
            <div class="text-sm space-y-2 rounded-lg bg-(--ui-bg-muted) p-4 min-w-48">
              <div>
                <span class="font-semibold">{{ c.progress.people.toLocaleString() }}</span>
                {{ c.progress.people === 1 ? 'person signed up' : 'people signed up' }}
              </div>
              <div class="text-muted">
                {{ ptPlural(c.commitments, 'prayer time', 'prayer times') }}
              </div>
              <div
                v-if="c.progress.percent !== null && ptGoalText(c.progress)"
                class="w-48 space-y-1"
              >
                <UProgress
                  :model-value="Math.min(100, c.progress.percent)"
                  size="sm"
                />
                <p class="text-xs text-muted">
                  {{ ptGoalText(c.progress) }}
                </p>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-3 flex-wrap border-t border-default pt-4">
            <UButton
              v-if="canEdit && !c.published_at"
              :to="`/@${slug}/site/campaigns/setup/${c.id}`"
              size="lg"
              icon="i-lucide-list-checks"
              label="Continue setup"
            />
            <UButton
              :to="`/@${slug}/site/campaigns/${c.id}`"
              size="lg"
              :variant="canEdit && !c.published_at ? 'outline' : undefined"
              :color="canEdit && !c.published_at ? 'neutral' : undefined"
              :icon="canEdit ? 'i-lucide-pencil' : 'i-lucide-eye'"
              :label="canEdit ? 'Manage campaign' : 'View campaign'"
            />
            <UButton
              v-if="canEdit && c.status === 'ended' && (!blocker || c.kind === 'side')"
              :to="`/@${slug}/site/campaigns/new?relaunch=${c.id}`"
              size="sm"
              variant="outline"
              color="neutral"
              icon="i-lucide-rotate-ccw"
              label="Relaunch"
            />
            <UButton
              v-if="canEdit && c.commitments === 0"
              size="sm"
              variant="ghost"
              color="error"
              icon="i-lucide-trash-2"
              label="Delete"
              @click="askDelete(c)"
            />
            <UButton
              :to="{ path: `/@${slug}/site/landing`, query: { campaign: c.id } }"
              size="sm"
              variant="ghost"
              color="neutral"
              icon="i-lucide-panels-top-left"
              label="Landing page"
            />
            <UButton
              :to="{ path: `/@${slug}/site/stats`, query: { campaign: c.id } }"
              size="sm"
              variant="ghost"
              color="neutral"
              icon="i-lucide-chart-line"
              label="Stats"
            />
            <UButton
              v-if="resultsUrl(c)"
              :to="resultsUrl(c)"
              target="_blank"
              size="sm"
              variant="ghost"
              color="neutral"
              icon="i-lucide-external-link"
              label="Public results"
            />
            <UButton
              size="sm"
              variant="soft"
              :icon="expanded === c.id ? 'i-lucide-chevron-up' : 'i-lucide-mail'"
              label="Thank-you message"
              @click="expanded = expanded === c.id ? null : c.id"
            />
          </div>
          <div
            v-if="expanded === c.id && site"
            class="border-t border-default pt-4"
          >
            <PtCampaignThankYou
              :campaign-id="c.id"
              :end-message="c.end_message"
              :cta="c.cta"
              :languages="site.site.languages"
              :default-language="site.site.default_language"
              @saved="refresh"
            />
          </div>
        </div>
      </UCard>
    </section>

    <UModal
      v-if="blocker"
      v-model:open="blockedOpen"
      :title="`${blocker.name} has no end date`"
      description="A site runs one main campaign at a time, and this one keeps running until it is ended. Another campaign with fixed dates, like Ramadan, can run alongside it as a side campaign."
    >
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            color="neutral"
            variant="ghost"
            label="Cancel"
            @click="blockedOpen = false"
          />
          <UButton
            to="/orgs/new"
            color="neutral"
            variant="outline"
            label="Create a new site"
          />
          <UButton
            :to="{ path: `/@${slug}/site/campaigns/new`, query: { kind: 'side' } }"
            icon="i-lucide-plus"
            label="New side campaign"
          />
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="confirm.open"
      title="Delete this campaign?"
      description="Nobody has signed up for it yet. Its setup and thank-you message are deleted too."
    >
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            color="neutral"
            variant="ghost"
            label="Cancel"
            @click="confirm.open = false"
          />
          <UButton
            color="error"
            :loading="confirming"
            label="Delete campaign"
            @click="doConfirm"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
