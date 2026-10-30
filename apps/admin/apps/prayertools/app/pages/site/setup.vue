<script setup lang="ts">
// Onboarding, continued on the draft site: the campaign setup wizard for the
// site's first campaign, ending in publishing the site. The current step is
// saved on the site, so setup can be resumed.
import { PT_SETUP_STEPS, type PtCampaign, type PtSetupStep } from '../../utils/pt-campaign-ui'

definePageMeta({ middleware: 'auth' })

const { data: site, refresh: refreshSite, can } = usePtSite()
const toast = usePtToast()
const route = useRoute()
const slug = computed(() => String(route.params.orgSlug))
const campaign = computed(() => (site.value?.currentCampaign ?? null) as PtCampaign | null)

const step = ref<PtSetupStep>('setup')
watch(site, (s) => {
  const saved = s?.site.onboarding?.step as PtSetupStep | undefined
  if (saved && PT_SETUP_STEPS.includes(saved) && step.value === 'setup') step.value = saved
}, { immediate: true })
function go(next: PtSetupStep) {
  step.value = next
  $fetch('/api/pt/site', { method: 'PATCH', body: { onboarding: { step: next } } }).catch(() => {})
}

const steps = ref<{ refreshChecklist: () => Promise<void> | undefined } | null>(null)
const publishing = ref(false)
async function publish() {
  publishing.value = true
  try {
    await $fetch('/api/pt/site/status', { method: 'POST', body: { action: 'publish' } })
    toast.ok('Your site is live', site.value?.url)
    await refreshSite()
    await navigateTo(`/@${slug.value}/site/landing/share`)
  } catch (err) {
    toast.fail(err, 'Could not publish')
    await steps.value?.refreshChecklist()
  } finally {
    publishing.value = false
  }
}
</script>

<template>
  <PtCampaignSetupSteps
    ref="steps"
    :step="step"
    :campaign="campaign"
    :reload="refreshSite"
    onboarding
    publish-label="Publish site"
    :may-publish="can('pt.site.manage')"
    :publishing="publishing"
    @update:step="go"
    @publish="publish"
  >
    <template #header>
      <div class="space-y-4">
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-(--ui-primary)">
          Campaign setup
        </p>
        <div class="flex items-center justify-between gap-4">
          <h1 class="text-3xl font-semibold sm:text-4xl">
            Set up {{ site?.org.name }}
          </h1>
          <UBadge
            :label="PT_LABELS.siteStatus[site?.site.status ?? 'draft']"
            :color="ptStatusColor(site?.site.status ?? 'draft')"
            variant="subtle"
          />
        </div>
        <p class="text-(--ui-text-muted)">
          Shape your campaign one step at a time. Your site stays a draft until you publish it.
        </p>
      </div>
    </template>
  </PtCampaignSetupSteps>
</template>
