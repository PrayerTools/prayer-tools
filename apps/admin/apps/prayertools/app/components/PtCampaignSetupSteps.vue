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
import { PT_SETUP_STEPS, type PtCampaign, type PtSetupStep } from '../utils/pt-campaign-ui'
import type { PtChecklist } from './PtLaunchChecklist.vue'
import { campaignDateError } from '../utils/pt-setup-validation'
import PtPrayerContentEditor from './PtPrayerContentEditor.vue'

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

const stepItems = computed(() => [
  { label: 'Campaign', value: 'setup', icon: 'i-lucide-calendar-range', description: 'Dates and prayer goals' },
  { label: 'Languages', value: 'languages', icon: 'i-lucide-languages', description: 'Welcome your community' },
  { label: 'Content', value: 'content', icon: 'i-lucide-book-open', description: 'Your daily prayer guide', disabled: !props.campaign },
  { label: 'Landing page', value: 'landing', icon: 'i-lucide-panels-top-left', description: 'Tell your story', disabled: !props.campaign },
  { label: 'Publish', value: 'publish', icon: 'i-lucide-rocket', description: 'Review and share your site', disabled: !props.campaign }
])
const stepNumber = computed(() => PT_SETUP_STEPS.indexOf(step.value) + 1)
// The checklist's Fix opens the step that holds the item.
function fixSetupItem(key: string) {
  const steps: Record<string, PtSetupStep> = { dates: 'setup', content: 'content', content_languages: 'content', place_wording: 'content', why: 'landing', description: 'landing', image: 'landing' }
  const target = steps[key]
  if (target) step.value = target
}

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
const dateError = computed(() => campaignDateError(draft.value.setup))
async function saveCampaign() {
  if (dateError.value) return
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
const contentSetup = ref<{ save: () => Promise<boolean>, hasContent: boolean } | null>(null)
// Once the campaign has content, Continue opens its entries for writing before the landing page.
const writingEntries = ref(false)
const prayerEditor = ref<{ dirty: boolean, saving: boolean } | null>(null)
watch([step, () => props.campaign?.id], () => {
  writingEntries.value = false
})
async function continueFromContent() {
  if (writingEntries.value) {
    step.value = 'landing'
    return
  }
  if (await contentSetup.value?.save() === false) return
  if (usesPlaceWording.value && !await savePlaceWording()) return
  if (contentSetup.value?.hasContent) writingEntries.value = true
  else step.value = 'landing'
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
    class="setup-page mx-auto space-y-8 py-3 sm:py-5"
    :class="step === 'landing' ? 'max-w-[96rem]' : 'max-w-6xl'"
  >
    <slot name="header" />

    <div class="setup-workspace">
      <nav
        class="setup-navigation"
        aria-label="Campaign setup steps"
      >
        <p class="mb-4 text-xs font-semibold uppercase tracking-wider text-(--ui-text-muted)">
          Step {{ stepNumber }} of {{ PT_SETUP_STEPS.length }}
        </p>
        <ol class="setup-step-list">
          <li
            v-for="item in stepItems"
            :key="item.value"
          >
            <button
              type="button"
              class="setup-step"
              :class="{ 'is-current': step === item.value }"
              :disabled="item.disabled"
              :aria-current="step === item.value ? 'step' : undefined"
              @click="step = item.value as PtSetupStep"
            >
              <UIcon
                :name="item.icon"
                class="size-5 shrink-0"
                aria-hidden="true"
              />
              <span class="text-start">
                <span class="block text-sm font-semibold whitespace-nowrap">{{ item.label }}</span>
                <span class="step-description mt-0.5 block text-xs text-(--ui-text-muted)">{{ item.description }}</span>
              </span>
            </button>
          </li>
        </ol>
        <p
          v-if="!campaign"
          class="mt-3 text-sm leading-relaxed text-(--ui-text-muted)"
        >
          Save your campaign to unlock prayer content.
        </p>
      </nav>
      <div class="setup-content min-w-0">
        <UCard
          v-if="step === 'setup'"
          class="setup-panel"
        >
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
                size="lg"
                icon="i-lucide-save"
                :loading="savingCampaign"
                :disabled="!draft.setup.goal || !!dateError"
                @click="saveCampaign"
              />
            </div>
          </template>
        </UCard>

        <UCard
          v-else-if="step === 'languages'"
          class="setup-panel"
        >
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
                size="lg"
                icon="i-lucide-save"
                :loading="savingLanguages"
                :disabled="!languages.length"
                @click="saveLanguages"
              />
            </div>
          </template>
        </UCard>

        <template v-else-if="campaign">
          <UCard
            v-if="step === 'content'"
            class="setup-panel"
          >
            <template #header>
              <h2 class="font-semibold">
                Prayer content
                <InfoTip text="Use a library as it is (fixes and new translations reach you automatically), change it to suit your site, or write your own." />
              </h2>
            </template>
            <PtPrayerContentEditor
              v-if="writingEntries"
              ref="prayerEditor"
              embedded
              :initial-campaign-id="campaign.id"
            />
            <PtCampaignContentSetup
              v-else
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
              <div class="flex items-center justify-end gap-2">
                <UButton
                  v-if="writingEntries"
                  label="Back to content choices"
                  color="neutral"
                  variant="ghost"
                  @click="writingEntries = false"
                />
                <UButton
                  label="Continue"
                  size="lg"
                  trailing-icon="i-lucide-arrow-right"
                  :disabled="writingEntries && (!!prayerEditor?.dirty || !!prayerEditor?.saving)"
                  @click="continueFromContent"
                />
              </div>
              <p
                v-if="writingEntries && prayerEditor?.dirty"
                class="mt-2 text-right text-sm text-(--ui-text-muted)"
              >
                Save your current prayer entry before continuing.
              </p>
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
              within-setup
              @fix="fixSetupItem"
            />

            <UCard
              v-if="preview"
              class="setup-panel"
            >
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
    </div>
  </div>
</template>

<style scoped>
.setup-workspace { display: grid; gap: 1.5rem; }
.setup-navigation { min-width: 0; }
.setup-step-list { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.setup-step { display: flex; align-items: center; gap: 0.75rem; padding: 0.85rem 1rem; border: 1px solid var(--ui-border); border-radius: 0.85rem; color: var(--ui-text-muted); background: var(--ui-bg-elevated); transition: background 150ms ease, border-color 150ms ease; }
.setup-step:hover:not(:disabled) { border-color: var(--ui-primary); }
.setup-step.is-current { background: #fff0e3; border-color: #f58220; color: #8a3b0a; }
.setup-step:disabled { opacity: 0.45; cursor: not-allowed; }
.step-description { display: none; }
.setup-content :deep(.setup-panel) { background: var(--ui-bg-elevated); border-radius: var(--radius-lg); box-shadow: 0 8px 30px #20283305; }
.setup-content :deep(.setup-panel > div) { padding: 1.5rem; }
.setup-content :deep(h2) { font-size: 1.2rem; line-height: 1.5; }
.setup-content :deep(input:not([type='radio']):not([type='checkbox'])) { min-height: 2.5rem; }
@media (min-width: 1200px) {
  .setup-workspace { grid-template-columns: 15rem minmax(0, 1fr); gap: 2rem; }
  .setup-navigation { position: sticky; top: 5.5rem; align-self: start; }
  .setup-step-list { flex-direction: column; overflow: visible; }
  .setup-step { width: 100%; padding: 1rem; }
  .step-description { display: block; }
}
:global(.dark) .setup-step.is-current { background: #472f1d; color: #ffb376; }
</style>
