<script setup lang="ts">
// The setup wizard for one campaign: its answers, the site's languages, its
// prayer content and landing page, then the checklist, a preview and Publish
// (for a draft).
import { PT_SETUP_STEPS, type PtCampaign, type PtSetupStep } from '../../../../utils/pt-campaign-ui'

definePageMeta({ middleware: 'auth' })

const route = useRoute()
const router = useRouter()
const id = computed(() => String(route.params.id))
const { data: site, can, slug } = usePtSite()
const toast = usePtToast()
const { select } = usePtCampaign()
watch(id, v => select(v), { immediate: true })
const { data, refresh } = useFetch<{ campaign: PtCampaign }>(() => `/api/pt/campaigns/${id.value}`, { key: computed(() => `pt-campaign-${id.value}`) })
const campaign = computed(() => data.value?.campaign ?? null)

const step = computed<PtSetupStep>({
  get: () => PT_SETUP_STEPS.includes(route.query.step as PtSetupStep) ? route.query.step as PtSetupStep : 'content',
  set: v => router.replace({ query: { ...route.query, step: v } })
})

const steps = ref<{ refreshChecklist: () => Promise<void> | undefined } | null>(null)
const publishing = ref(false)
async function publish() {
  publishing.value = true
  try {
    await $fetch(`/api/pt/campaigns/${id.value}/publish`, { method: 'POST' })
    await Promise.all([refresh(), refreshNuxtData(ptCampaignsKey(slug.value))])
    toast.ok('Campaign published')
    await navigateTo(`/site/campaigns/${id.value}`)
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
    v-if="campaign && site"
    ref="steps"
    v-model:step="step"
    :campaign="campaign"
    :reload="refresh"
    publish-label="Publish campaign"
    :may-publish="!campaign.published_at && can('pt.campaigns.write')"
    :publishing="publishing"
    checklist-title="Before you publish"
    @publish="publish"
  >
    <template #header>
      <UButton
        to="/site/campaigns"
        icon="i-lucide-arrow-left"
        variant="link"
        color="neutral"
        label="Campaigns"
        class="px-0"
      />
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <h1 class="text-2xl font-semibold">
          Set up {{ campaign.name }}
        </h1>
        <UBadge
          :label="campaign.published_at ? 'Published' : 'Draft'"
          :color="campaign.published_at ? 'success' : 'neutral'"
          variant="subtle"
        />
      </div>
    </template>
  </PtCampaignSetupSteps>
</template>
