<script setup lang="ts">
// Sets up a draft campaign before it goes on the public site: its prayer
// content, its landing page, then the checklist, a preview and Publish. Its
// dates and setup answers were chosen when it was created.
import type { PtCampaign } from '../../../../utils/pt-campaign-ui'
import type { PtChecklist } from '../../../../components/PtLaunchChecklist.vue'

definePageMeta({ middleware: 'auth' })

const STEPS = ['content', 'landing', 'publish'] as const
type Step = typeof STEPS[number]

const route = useRoute()
const router = useRouter()
const id = computed(() => String(route.params.id))
const { data: site, can } = usePtSite()
const toast = usePtToast()
const { select } = usePtCampaign()
watch(id, v => select(v), { immediate: true })
const { data, refresh } = useFetch<{ campaign: PtCampaign }>(() => `/api/pt/campaigns/${id.value}`, { key: computed(() => `pt-campaign-${id.value}`) })
const campaign = computed(() => data.value?.campaign ?? null)

const step = computed<Step>({
  get: () => STEPS.includes(route.query.step as Step) ? route.query.step as Step : 'content',
  set: v => router.replace({ query: { ...route.query, step: v } })
})

// The campaign on the site's root address previews there; others at their own path.
const preview = ref<string | null>(null)
async function makePreview() {
  try {
    const res = await $fetch<{ url: string }>('/api/pt/site/preview-link', { method: 'POST' })
    const c = campaign.value
    preview.value = c && site.value?.currentCampaign?.id !== c.id ? `${res.url}?to=/${c.slug}` : res.url
  } catch (err) {
    toast.fail(err)
  }
}
watch([step, campaign], ([s, c]) => {
  if (s === 'publish' && c && !preview.value) makePreview()
}, { immediate: true })

const contentSetup = ref<{ save: () => Promise<boolean> } | null>(null)
async function continueFromContent() {
  if (await contentSetup.value?.save() !== false) step.value = 'landing'
}

const checklist = ref<{ refresh: () => Promise<void>, data: PtChecklist | null } | null>(null)
const publishing = ref(false)
async function publish() {
  publishing.value = true
  try {
    await $fetch(`/api/pt/campaigns/${id.value}/publish`, { method: 'POST' })
    await Promise.all([refresh(), refreshNuxtData('pt-campaigns')])
    toast.ok('Campaign published')
    await navigateTo(`/site/campaigns/${id.value}`)
  } catch (err) {
    toast.fail(err, 'Could not publish')
    await checklist.value?.refresh()
  } finally {
    publishing.value = false
  }
}
</script>

<template>
  <div
    v-if="campaign && site"
    class="mx-auto space-y-6"
    :class="step === 'landing' ? 'max-w-[96rem]' : 'max-w-3xl'"
  >
    <div class="max-w-3xl mx-auto space-y-6">
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
        <div class="flex items-center gap-2">
          <UBadge
            :label="campaign.published_at ? 'Published' : 'Draft'"
            :color="campaign.published_at ? 'success' : 'neutral'"
            variant="subtle"
          />
          <UButton
            :to="`/site/campaigns/${campaign.id}`"
            variant="ghost"
            color="neutral"
            icon="i-lucide-calendar-range"
            label="Dates and setup"
          />
        </div>
      </div>
      <UTabs
        v-model="step"
        :items="[
          { label: 'Content', value: 'content', icon: 'i-lucide-book-open' },
          { label: 'Landing page', value: 'landing', icon: 'i-lucide-panels-top-left' },
          { label: 'Publish', value: 'publish', icon: 'i-lucide-rocket' }
        ]"
        :content="false"
        class="w-full"
      />
    </div>

    <UCard v-if="step === 'content'">
      <template #header>
        <h2 class="font-semibold">
          Prayer content
          <InfoTip text="Use a library as it is (fixes and new translations reach you automatically), change it to suit your site, or write your own." />
        </h2>
      </template>
      <PtCampaignContentSetup
        ref="contentSetup"
        :campaign="campaign"
        :template-key="campaign.template_key ?? 'generic'"
        @changed="refresh"
      />
      <template #footer>
        <div class="flex justify-end">
          <UButton
            label="Continue"
            @click="continueFromContent"
          />
        </div>
      </template>
    </UCard>

    <PtLandingEditor
      v-else-if="step === 'landing'"
      :campaign-id="campaign.id"
      save-label="Save and continue"
      @saved="step = 'publish'"
    >
      <template #heading>
        <h2 class="font-semibold">
          Landing page
          <InfoTip text="Write the parts that are yours and hide what you don't need. The preview shows the page as you edit." />
        </h2>
      </template>
    </PtLandingEditor>

    <div
      v-else-if="step === 'publish'"
      class="space-y-6"
    >
      <PtLaunchChecklist
        ref="checklist"
        :campaign-id="campaign.id"
        title="Before you publish"
      />

      <UCard v-if="preview">
        <template #header>
          <h3 class="font-semibold">
            Preview
          </h3>
        </template>
        <div class="flex flex-col sm:flex-row gap-6 items-start">
          <PtQrCode
            :value="preview"
            :size="150"
          />
          <div class="space-y-3 text-sm">
            <p class="text-(--ui-text-muted)">
              Scan the code to open the draft on your phone, or open it here. Only people with this link can see it.
            </p>
            <UButton
              :to="preview"
              target="_blank"
              icon="i-lucide-external-link"
              color="neutral"
              variant="outline"
              label="Open preview"
            />
          </div>
        </div>
      </UCard>

      <div
        v-if="!campaign.published_at && can('pt.campaigns.write')"
        class="flex items-center gap-3 flex-wrap"
      >
        <UButton
          size="xl"
          icon="i-lucide-rocket"
          label="Publish campaign"
          :loading="publishing"
          :disabled="!checklist?.data?.canPublish"
          @click="publish"
        />
        <span
          v-if="!checklist?.data?.canPublish"
          class="text-sm text-(--ui-text-muted)"
        >Finish the items marked “needed to publish” first.</span>
      </div>
    </div>
  </div>
</template>
