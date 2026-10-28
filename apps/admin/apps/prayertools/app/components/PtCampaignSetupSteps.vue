<script setup lang="ts">
// The setup wizard for a campaign, the same in site onboarding and for a
// campaign of a live site: the campaign (template, setup answers, place and
// timezone), the site's languages, prayer content (with the place's wording
// once the content names the place), landing page, then the checklist, a
// preview link and Publish. `onboarding`
// creates the campaign when the site has none yet and makes its timezone the
// site's. The page publishes (the site or the campaign) on `publish` and
// calls `refreshChecklist` when that fails; `reload` refetches the campaign.
import { campaignSegment } from '@prayertools/shared/campaigns'
import type { SitePlaceWording } from '@prayertools/shared/place'
import type { PtCampaign, PtSetupStep } from '../utils/pt-campaign-ui'
import type { PtChecklist } from './PtLaunchChecklist.vue'

const props = defineProps<{
  campaign: PtCampaign | null
  reload: () => Promise<unknown>
  onboarding?: boolean
  publishLabel: string
  // Shows the Publish button.
  mayPublish: boolean
  publishing?: boolean
  checklistTitle?: string
}>()
const step = defineModel<PtSetupStep>('step', { required: true })
const emit = defineEmits<{ publish: [] }>()

const { data: site, refresh: refreshSite, slug } = usePtSite()
const toast = usePtToast()

const tabs = computed(() => [
  { label: 'Campaign', value: 'setup', icon: 'i-lucide-calendar-range' },
  { label: 'Languages', value: 'languages', icon: 'i-lucide-languages' },
  { label: 'Content', value: 'content', icon: 'i-lucide-book-open', disabled: !props.campaign },
  { label: 'Landing page', value: 'landing', icon: 'i-lucide-panels-top-left', disabled: !props.campaign },
  { label: 'Publish', value: 'publish', icon: 'i-lucide-rocket', disabled: !props.campaign }
])

async function reloadAll() {
  await Promise.all([props.reload(), refreshSite(), refreshNuxtData(ptCampaignsKey(slug.value))])
}

// ── Step: the campaign ──────────────────────────────────────────────────
const { draft, fillFrom, chooseTemplate, toBody } = usePtCampaignDraft({ fallbackName: () => props.onboarding ? site.value?.org.name ?? '' : '' })
watch(site, (s) => {
  if (s && !props.campaign) draft.value.timezone = s.site.timezone
}, { immediate: true })
watch(() => props.campaign?.id, () => {
  if (props.campaign) fillFrom(props.campaign)
}, { immediate: true })

const savingCampaign = ref(false)
async function saveCampaign() {
  savingCampaign.value = true
  try {
    if (props.onboarding) await $fetch('/api/pt/site', { method: 'PATCH', body: { timezone: draft.value.timezone } })
    // The place wording is edited on the Languages step.
    const { place_wording: _wording, ...answers } = toBody()
    const body = { ...answers, name: draft.value.name.trim() || site.value?.org.name }
    if (props.campaign) await $fetch(`/api/pt/campaigns/${props.campaign.id}`, { method: 'PATCH', body })
    else await $fetch('/api/pt/campaigns', { method: 'POST', body })
    await reloadAll()
    step.value = 'languages'
  } catch (err) {
    toast.fail(err)
  } finally {
    savingCampaign.value = false
  }
}

// ── Step: languages ─────────────────────────────────────────────────────
const languages = ref<string[]>(['en'])
const defaultLanguage = ref('en')
watch(site, (s) => {
  if (!s) return
  languages.value = [...s.site.languages]
  defaultLanguage.value = s.site.default_language
}, { immediate: true })
const savingLanguages = ref(false)
async function saveLanguages() {
  savingLanguages.value = true
  try {
    if (!languages.value.includes(defaultLanguage.value)) defaultLanguage.value = languages.value[0] ?? 'en'
    await $fetch('/api/pt/site', { method: 'PATCH', body: { languages: languages.value, default_language: defaultLanguage.value } })
    await reloadAll()
    step.value = 'content'
  } catch (err) {
    toast.fail(err)
  } finally {
    savingLanguages.value = false
  }
}

// ── Steps: content, landing page and publish ────────────────────────────
const contentSetup = ref<{ save: () => Promise<boolean> } | null>(null)
async function continueFromContent() {
  if (await contentSetup.value?.save() === false) return
  if (usesPlaceWording.value && !await savePlaceWording()) return
  step.value = 'landing'
}

// The place's wording, shown only when the campaign's content names the place.
const placeWording = ref<SitePlaceWording>({})
watch(() => props.campaign?.id, () => {
  placeWording.value = { ...props.campaign?.place_wording }
}, { immediate: true })
const usesPlaceWording = ref(false)
async function checkPlaceWording() {
  if (!props.campaign?.place_name) {
    usesPlaceWording.value = false
    return
  }
  try {
    const res = await $fetch<{ campaign: { usesPlaceWording: boolean } }>(`/api/pt/campaigns/${props.campaign.id}`)
    usesPlaceWording.value = res.campaign.usesPlaceWording
  } catch (err) {
    toast.fail(err)
  }
}
watch([step, () => props.campaign?.id], ([s]) => {
  if (s === 'content') checkPlaceWording()
}, { immediate: true })
async function savePlaceWording(): Promise<boolean> {
  try {
    await $fetch(`/api/pt/campaigns/${props.campaign!.id}`, { method: 'PATCH', body: { place_wording: placeWording.value } })
    await props.reload()
    return true
  } catch (err) {
    toast.fail(err)
    return false
  }
}

// The campaign on the site's root address previews there; others at their own path.
const preview = ref<string | null>(null)
async function makePreview() {
  if (!props.campaign) return
  try {
    const res = await $fetch<{ url: string }>('/api/pt/site/preview-link', { method: 'POST' })
    const segment = campaignSegment(props.campaign, site.value?.currentCampaign?.id)
    preview.value = segment ? `${res.url}?to=/${segment}` : res.url
  } catch (err) {
    toast.fail(err)
  }
}
watch([step, () => props.campaign?.id], ([s]) => {
  if (s === 'publish' && !preview.value) makePreview()
}, { immediate: true })

const checklist = ref<{ refresh: () => Promise<void>, data: PtChecklist | null } | null>(null)
defineExpose({ refreshChecklist: () => checklist.value?.refresh() })
</script>

<template>
  <div
    class="mx-auto space-y-6"
    :class="step === 'landing' ? 'max-w-[96rem]' : 'max-w-3xl'"
  >
    <div class="max-w-3xl mx-auto space-y-6">
      <slot name="header" />
      <UTabs
        v-model="step"
        :items="tabs"
        :content="false"
        class="w-full"
      />
    </div>

    <UCard v-if="step === 'setup'">
      <template #header>
        <h2 class="font-semibold">
          Your campaign <InfoTip text="You can change all of this later." />
        </h2>
      </template>
      <PtCampaignFields
        v-model="draft"
        with-template
        :lock-template="onboarding"
        :with-cadence="false"
        :with-length="false"
        :with-place-wording="false"
        :dated="campaign?.kind === 'side'"
        @choose="chooseTemplate"
      />
      <template #footer>
        <div class="flex items-center justify-end gap-3">
          <span
            v-if="!draft.setup.goal"
            class="text-sm text-(--ui-text-muted)"
          >Choose a goal to continue.</span>
          <UButton
            label="Save and continue"
            :loading="savingCampaign"
            :disabled="!draft.setup.goal"
            @click="saveCampaign"
          />
        </div>
      </template>
    </UCard>

    <UCard v-else-if="step === 'languages'">
      <template #header>
        <h2 class="font-semibold">
          Languages
        </h2>
      </template>
      <div class="divide-y divide-(--ui-border-accented)">
        <UFormField
          :ui="{ label: 'text-base font-semibold' }"
          class="py-6 first:pt-0 last:pb-0"
        >
          <template #label>
            Languages the site runs in <InfoTip text="Visitors can switch between these; content should exist in each." />
          </template>
          <PtLanguagePicker
            v-model="languages"
            v-model:default="defaultLanguage"
          />
        </UFormField>
      </div>
      <template #footer>
        <div class="flex justify-end">
          <UButton
            label="Save and continue"
            :loading="savingLanguages"
            :disabled="!languages.length"
            @click="saveLanguages"
          />
        </div>
      </template>
    </UCard>

    <template v-else-if="campaign">
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
          @changed="reload"
          @added="checkPlaceWording"
        >
          <template #after-libraries>
            <UFormField
              v-if="campaign.place_name && usesPlaceWording"
              :ui="{ label: 'text-base font-semibold' }"
              class="py-6 first:pt-0 last:pb-0"
            >
              <template #label>
                How your place is written <InfoTip text="Its name in each language, and how to say “in” and “of” it. Prayer guides use these to name your place." />
              </template>
              <PtPlaceWording
                v-model="placeWording"
                :place-name="campaign.place_name"
                :languages="languages"
              />
            </UFormField>
          </template>
        </PtCampaignContentSetup>
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
            <InfoTip text="Write the parts that are yours and hide what you don't need. The preview shows the page with its look as you edit." />
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
          :title="checklistTitle"
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
                Scan the code to open the draft on your phone, or open it here. Only people with this link can
                see it. Save to see your latest changes.
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
          v-if="mayPublish"
          class="flex items-center gap-3 flex-wrap"
        >
          <UButton
            size="xl"
            icon="i-lucide-rocket"
            :label="publishLabel"
            :loading="publishing"
            :disabled="!checklist?.data?.canPublish"
            @click="emit('publish')"
          />
          <span
            v-if="!checklist?.data?.canPublish"
            class="text-sm text-(--ui-text-muted)"
          >Finish the items marked “needed to publish” first.</span>
        </div>
      </div>
    </template>
  </div>
</template>
