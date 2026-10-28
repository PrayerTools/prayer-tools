<script setup lang="ts">
// Site dashboard for the campaign chosen in the switcher (the current one by
// default): where it stands, its link, setup and share actions, people and
// goal progress, setup still to do, quick links and giving.
import { campaignUrl as campaignUrlOf } from '@prayertools/shared/campaigns'
import type { PtChecklist } from '../../components/PtLaunchChecklist.vue'

definePageMeta({ middleware: 'auth' })

const { data: site, error, can, slug, refresh: refreshSite } = usePtSite()
const { data: meta } = usePtMeta()
const toast = usePtToast()
const { id: campaignId, campaign, campaigns } = usePtCampaign()
const { data: stats } = useFetch<{ totals: Record<string, number>, progress: { goal: string, people: number, value: number, target: number | null, percent: number | null } | null, prayingNow: number, commitments: number }>('/api/pt/stats', {
  query: computed(() => ({ campaign: campaignId.value })),
  key: computed(() => `pt-dash-stats-${slug.value}-${campaignId.value}`)
})
// The campaign on the root address is at the site's link; any other at its own path.
const campaignUrl = computed(() => {
  const c = campaign.value
  if (!site.value || !c) return site.value?.url ?? ''
  return campaignUrlOf(site.value.url, c, site.value.currentCampaign?.id)
})
const setupUrl = computed(() => status.value === 'draft' || !campaign.value ? '/site/setup' : `/site/campaigns/setup/${campaign.value.id}`)
const notASite = computed(() => (error.value as { statusCode?: number } | null)?.statusCode === 404)
const status = computed(() => site.value?.site.status ?? 'draft')
const hasCustomDomain = computed(() => !!site.value?.domains.some(d => d.status === 'active'))
const checklist = ref<{ refresh: () => Promise<void>, data: PtChecklist | null } | null>(null)

const daysUntil = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) / 86_400_000)

const phaseText = computed(() => {
  const c = campaign.value
  if (!c) return 'No campaign yet.'
  if (!c.published_at) return `${c.name} is a draft. Finish its setup and publish it to put it on your site.`
  if (c.start_mode === 'join') return `${c.name}: open since ${ptFormatDate(c.start_date)}. Each person starts when they join.`
  if (c.status === 'upcoming') {
    const n = daysUntil(c.start_date!)
    return `${c.name} starts ${ptFormatDate(c.start_date)} (in ${n} ${n === 1 ? 'day' : 'days'}). Signup is open.`
  }
  if (c.status === 'active') return c.end_date ? `${c.name} runs until ${ptFormatDate(c.end_date)}.` : `${c.name} has run since ${ptFormatDate(c.start_date)}, with no end date.`
  return site.value?.currentCampaign?.id === c.id
    ? `${c.name} ended ${c.end_date ? ptFormatDate(c.end_date) : ''}. The site shows the results and offers “Notify me when this campaign runs again”.`
    : `${c.name} ended ${c.end_date ? ptFormatDate(c.end_date) : ''}.`
})

const progressLabel = computed(() => {
  const p = stats.value?.progress
  if (!p) return null
  if (p.goal === 'people') return p.target ? `${p.people.toLocaleString()} of ${p.target.toLocaleString()} people signed up` : `${p.people.toLocaleString()} people signed up`
  if (p.goal === 'prayer_time') return `${Math.round(p.value / 60 * 10) / 10} of ${Math.round((p.target ?? 1440) / 60)} hours of prayer a day`
  return `${p.value}% of the time covered around the clock`
})

const publishing = ref(false)
async function publish() {
  publishing.value = true
  try {
    await $fetch('/api/pt/site/status', { method: 'POST', body: { action: 'publish' } })
    toast.ok('Your site is live', site.value?.url)
    await refreshSite()
  } catch (err) {
    toast.fail(err, 'Not published yet')
  } finally {
    publishing.value = false
    await checklist.value?.refresh()
  }
}

async function dismissOnboarding() {
  try {
    await $fetch('/api/pt/site', { method: 'PATCH', body: { onboarding: { ...(site.value?.site.onboarding ?? {}), completed: true } } })
    await refreshSite()
  } catch (err) {
    toast.fail(err)
  }
}

async function copyLink() {
  if (!campaignUrl.value) return
  await navigator.clipboard.writeText(campaignUrl.value)
  toast.ok('Link copied')
}

const quickLinks = computed(() => [
  { label: 'Prayer content', icon: 'i-lucide-book-open', to: '/site/content', perm: 'pt.site.read' },
  { label: 'Landing page', icon: 'i-lucide-panels-top-left', to: '/site/landing', perm: 'pt.site.read' },
  { label: 'Settings', icon: 'i-lucide-settings', to: '/site/settings', perm: 'pt.site.read' },
  { label: 'Intercessors', icon: 'i-lucide-users', to: '/crm/contacts', perm: 'crm.contacts.read' },
  { label: 'Stats', icon: 'i-lucide-chart-line', to: '/site/stats', perm: 'pt.stats.read' },
  { label: 'Campaigns', icon: 'i-lucide-calendar-range', to: '/site/campaigns', perm: 'pt.site.read' },
  { label: 'Share', icon: 'i-lucide-share-2', to: '/site/landing/share', perm: 'pt.site.read' },
  { label: 'Team', icon: 'i-lucide-user-cog', to: '/site/team', perm: 'org.members.read' }
].filter(l => can(l.perm)))
</script>

<template>
  <div class="max-w-5xl mx-auto space-y-6">
    <UCard v-if="notASite">
      <p class="text-sm">
        This organization isn't a prayer campaign site.
      </p>
      <UButton
        class="mt-3"
        :to="`/@${slug}/crm`"
        label="Open the CRM"
      />
    </UCard>

    <template v-else-if="site">
      <PtCampaignSwitcher />
      <header class="flex items-start justify-between gap-4 flex-wrap">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h1 class="text-2xl font-bold truncate">
              {{ site.org.name }}
            </h1>
            <UBadge
              :label="PT_LABELS.siteStatus[status]"
              :color="ptStatusColor(status)"
              variant="subtle"
            />
          </div>
          <p class="text-sm text-(--ui-text-muted) mt-1">
            {{ phaseText }}
          </p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <UButton
            v-if="can('pt.site.write')"
            :to="setupUrl"
            variant="outline"
            color="neutral"
            icon="i-lucide-wand-sparkles"
            label="Setup wizard"
          />
          <UButton
            v-if="status === 'published' && campaign?.published_at"
            :to="campaignUrl"
            target="_blank"
            variant="outline"
            color="neutral"
            icon="i-lucide-external-link"
            label="View site"
          />
          <UButton
            v-if="status === 'published' && campaign?.published_at"
            to="/site/landing/share"
            icon="i-lucide-share-2"
            label="Share"
          />
          <UButton
            v-if="status === 'draft' && can('pt.site.manage')"
            icon="i-lucide-rocket"
            label="Publish"
            :loading="publishing"
            :disabled="!checklist?.data?.canPublish"
            @click="publish"
          />
        </div>
      </header>

      <UAlert
        v-if="status === 'draft' && !site.site.onboarding?.completed && can('pt.site.write')"
        color="primary"
        variant="subtle"
        icon="i-lucide-list-todo"
        title="Your site isn't set up yet"
        description="Pick up where you left off: campaign, address and languages, content, landing page, look and publish."
        :actions="[
          { label: 'Continue setup', to: '/site/setup', trailingIcon: 'i-lucide-arrow-right' },
          { label: 'I\'ll use the menus instead', variant: 'ghost', color: 'neutral', onClick: dismissOnboarding }
        ]"
      />

      <UAlert
        v-if="status === 'archived'"
        color="warning"
        variant="subtle"
        icon="i-lucide-archive"
        title="This site is archived"
        description="It shows a short “this campaign has ended” page. No signups and no reminders. You can un-archive it in Settings."
      />

      <div class="grid gap-4 md:grid-cols-3">
        <UCard class="md:col-span-2">
          <div class="space-y-4">
            <div class="flex items-center justify-between gap-2">
              <h2 class="font-semibold">
                Link
              </h2>
              <UBadge
                v-if="hasCustomDomain"
                color="success"
                variant="subtle"
                label="Custom domain"
              />
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-mono text-sm break-all">{{ campaignUrl }}</span>
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                icon="i-lucide-copy"
                aria-label="Copy link"
                @click="copyLink"
              />
            </div>
            <p
              v-if="status === 'draft' || (campaign && !campaign.published_at)"
              class="text-xs text-(--ui-text-muted)"
            >
              The link works once {{ status === 'draft' ? 'the site' : 'the campaign' }} is published. Until then, use the preview in the setup wizard.
            </p>
          </div>
        </UCard>

        <UCard>
          <div class="space-y-1">
            <p class="text-sm text-(--ui-text-muted)">
              Praying now
            </p>
            <p class="text-3xl font-bold">
              {{ can('pt.stats.read') ? (stats?.prayingNow ?? 0) : '–' }}
            </p>
          </div>
        </UCard>
      </div>

      <div
        v-if="!campaigns.length"
        class="flex"
      >
        <UButton
          to="/site/campaigns/new"
          label="Create a campaign"
          icon="i-lucide-plus"
        />
      </div>

      <div
        v-else-if="stats?.progress"
        class="grid gap-4 md:grid-cols-3"
      >
        <UCard>
          <p class="text-sm text-(--ui-text-muted)">
            People signed up
          </p>
          <p class="text-3xl font-bold">
            {{ stats.progress.people.toLocaleString() }}
          </p>
        </UCard>
        <UCard class="md:col-span-2">
          <div class="space-y-2">
            <p class="text-sm text-(--ui-text-muted)">
              {{ PT_LABELS.goal[stats.progress.goal] }}
            </p>
            <UProgress
              v-if="stats.progress.percent !== null"
              :model-value="Math.min(100, stats.progress.percent)"
              :max="100"
            />
            <p class="text-sm">
              {{ progressLabel }}
            </p>
          </div>
        </UCard>
        <UCard class="md:col-span-3">
          <p class="text-sm text-(--ui-text-muted) mb-2">
            Prayer activity in {{ campaign?.name ?? 'this campaign' }}
          </p>
          <div class="grid grid-cols-3 gap-4">
            <div>
              <p class="text-2xl font-semibold">
                {{ (stats.totals.prayers ?? 0).toLocaleString() }}
              </p>
              <p class="text-xs text-(--ui-text-muted)">
                prayer times
              </p>
            </div>
            <div>
              <p class="text-2xl font-semibold">
                {{ Math.round((stats.totals.prayer_seconds ?? 0) / 60).toLocaleString() }}
              </p>
              <p class="text-xs text-(--ui-text-muted)">
                minutes prayed
              </p>
            </div>
            <div>
              <p class="text-2xl font-semibold">
                {{ (stats.totals.shares ?? 0).toLocaleString() }}
              </p>
              <p class="text-xs text-(--ui-text-muted)">
                shares
              </p>
            </div>
          </div>
        </UCard>
      </div>

      <PtLaunchChecklist
        ref="checklist"
        open-only
        title="Still to do"
        :campaign-id="campaignId"
      />

      <div class="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <UButton
          v-for="l in quickLinks"
          :key="l.to"
          :to="l.to"
          :icon="l.icon"
          :label="l.label"
          variant="outline"
          color="neutral"
          size="lg"
          class="justify-start"
        />
      </div>

      <UCard>
        <div class="flex items-start gap-4 flex-wrap">
          <UIcon
            name="i-lucide-hand-heart"
            class="size-8 text-(--ui-primary) shrink-0"
          />
          <div class="flex-1 min-w-60">
            <h2 class="font-semibold">
              Support Prayer.Tools
            </h2>
            <p class="text-sm text-(--ui-text-muted)">
              Prayer.Tools is free for every site. Gifts keep the servers, emails and new features going.
            </p>
          </div>
          <UButton
            :href="meta?.donateUrl"
            target="_blank"
            variant="outline"
            icon="i-lucide-heart"
            label="Give"
          />
        </div>
      </UCard>
    </template>
  </div>
</template>
