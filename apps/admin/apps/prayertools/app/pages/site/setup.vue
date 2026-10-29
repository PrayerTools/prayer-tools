<script setup lang="ts">
// Onboarding, continued on the draft site: about the site, template and
// campaign setup, languages, content, look, landing page (after the look,
// which shapes how it appears) and publish. The current step is saved on the
// site, so setup can be resumed.
import { suggestedStartDate } from '@prayertools/shared/setup'
import { addDays, todayIn } from '@prayertools/shared/dates'
import { heroImage } from '@prayertools/shared/hero-images'
import type { SitePlaceWording } from '@prayertools/shared/place'
import type { SetupState } from '../../components/PtSetupForm.vue'
import type { PtChecklist } from '../../components/PtLaunchChecklist.vue'
import type { PtLocation } from '../../components/PtLocationSearch.vue'
import { campaignDateError } from '../../utils/pt-setup-validation'
import PtPrayerContentEditor from '../../components/PtPrayerContentEditor.vue'

definePageMeta({ middleware: 'auth' })

const STEPS = ['about', 'setup', 'languages', 'content', 'look', 'landing', 'publish'] as const
type Step = typeof STEPS[number]

const { data: site, refresh: refreshSite, can } = usePtSite()
const { data: meta } = usePtMeta()
const toast = usePtToast()
const route = useRoute()
const slug = computed(() => String(route.params.orgSlug))

const step = ref<Step>('about')
const stepItems = computed(() => [
  { label: 'About', value: 'about', icon: 'i-lucide-info', description: 'Who you are praying for' },
  { label: 'Campaign', value: 'setup', icon: 'i-lucide-calendar-range', description: 'Dates and prayer goals' },
  { label: 'Languages', value: 'languages', icon: 'i-lucide-languages', description: 'Welcome your community' },
  { label: 'Content', value: 'content', icon: 'i-lucide-book-open', description: 'Your daily prayer guide', disabled: !existingCampaign.value },
  { label: 'Look', value: 'look', icon: 'i-lucide-palette', description: 'Colors, photos, and logo' },
  { label: 'Landing page', value: 'landing', icon: 'i-lucide-panels-top-left', description: 'Tell your story' },
  { label: 'Publish', value: 'publish', icon: 'i-lucide-rocket', description: 'Review and share your site' }
])
const stepNumber = computed(() => STEPS.indexOf(step.value) + 1)
watch(site, (s) => {
  const saved = s?.site.onboarding?.step as Step | undefined
  if (saved && STEPS.includes(saved) && step.value === 'about') step.value = saved
}, { immediate: true })

async function go(next: Step) {
  step.value = next
  await $fetch('/api/pt/site', { method: 'PATCH', body: { onboarding: { step: next } } }).catch(() => {})
}
function fixSetupItem(key: string) {
  const steps: Record<string, Step> = { dates: 'setup', content: 'content', content_languages: 'content', place_wording: 'languages', why: 'landing', description: 'landing', image: 'look' }
  const target = steps[key]
  if (target) go(target)
}

// ── Step: about the site ─────────────────────────────────────────────────
const about = reactive({ purpose: 'place', people_group: '', timezone: 'UTC' })
const location = ref<PtLocation | null>(null)
watch(site, (s) => {
  if (!s) return
  Object.assign(about, { purpose: s.site.purpose ?? 'place', people_group: s.site.people_group ?? '', timezone: s.site.timezone })
  location.value = s.site.place_name ? { name: s.site.place_name, latitude: s.site.latitude, longitude: s.site.longitude } : null
}, { immediate: true })
const purposeItems = Object.entries(PT_LABELS.purpose).map(([value, label]) => ({ value, label, description: PT_LABELS.purposeDescription[value] }))
const savingAbout = ref(false)
async function saveAbout() {
  savingAbout.value = true
  try {
    await $fetch('/api/pt/site', {
      method: 'PATCH',
      body: {
        purpose: about.purpose,
        people_group: about.purpose === 'people_group' ? about.people_group : null,
        place_name: location.value?.name ?? null,
        latitude: location.value?.latitude ?? null,
        longitude: location.value?.longitude ?? null,
        timezone: about.timezone
      }
    })
    await refreshSite()
    await go('setup')
  } catch (err) {
    toast.fail(err)
  } finally {
    savingAbout.value = false
  }
}

// ── Step: template + campaign setup ─────────────────────────────────────
const templateKey = ref('generic')
const templateItems = computed(() => (meta.value?.templates ?? []).map(t => ({
  value: t.key,
  label: PT_LABELS.template[t.key],
  description: PT_LABELS.templateDescription[t.key]
})))
watch(site, s => { if (s?.site.template_key) templateKey.value = s.site.template_key }, { immediate: true })
const campaignName = ref('')
const setup = ref<SetupState>({ start_mode: 'date', start_date: null, end_mode: 'date', end_date: null, length_days: null, goal: 'people', cadence: 'daily', track_time: false, goal_target: 100, slot_min: null })
const existingCampaign = computed(() => site.value?.currentCampaign ?? null)

watch(existingCampaign, (c) => {
  if (!c) return
  campaignName.value = c.name
  setup.value = { start_mode: c.start_mode, start_date: c.start_date, end_mode: c.end_mode, end_date: c.end_date, length_days: c.length_days, goal: c.goal, cadence: c.cadence, track_time: c.track_time, goal_target: c.goal_target, slot_min: c.slot_min ?? null }
}, { immediate: true })

function chooseTemplate(key: string) {
  templateKey.value = key
  const t = meta.value?.templates.find(x => x.key === key)
  if (!t) return
  setup.value = { ...setup.value, ...(t.setup as Partial<SetupState>) }
  if (t.setup.length_days && setup.value.start_mode === 'date') setup.value.length_days = null
  const start = setup.value.start_mode === 'date' ? suggestedStartDate(key, todayIn(site.value?.site.timezone ?? 'UTC')) : null
  if (start) setup.value.start_date = start
  fillEndDate()
  if (!campaignName.value && site.value) {
    const year = (setup.value.start_date ?? new Date().toISOString()).slice(0, 4)
    campaignName.value = key === 'ramadan' ? `Ramadan ${year}` : site.value.org.name
  }
}

// Templates with a fixed length end their date campaigns that many days after the start.
function fillEndDate() {
  const days = meta.value?.templates.find(x => x.key === templateKey.value)?.setup.length_days as number | undefined
  if (templateKey.value === 'generic' || !days || setup.value.start_mode !== 'date' || !setup.value.start_date) return
  setup.value.end_date = addDays(setup.value.start_date, days - 1)
}
watch(() => setup.value.start_date, fillEndDate)

const savingSetup = ref(false)
const setupDateError = computed(() => campaignDateError(setup.value))
async function saveSetup() {
  if (setupDateError.value) return
  savingSetup.value = true
  try {
    await $fetch('/api/pt/site', { method: 'PATCH', body: { template_key: templateKey.value } })
    const body = { ...setup.value, name: campaignName.value || site.value?.org.name, template_key: templateKey.value }
    if (templateKey.value !== 'generic' && setup.value.start_mode === 'date' && !existingCampaign.value) delete (body as Record<string, unknown>).end_date
    if (existingCampaign.value) await $fetch(`/api/pt/campaigns/${existingCampaign.value.id}`, { method: 'PATCH', body })
    else await $fetch('/api/pt/campaigns', { method: 'POST', body })
    await refreshSite()
    await go('languages')
  } catch (err) {
    toast.fail(err)
  } finally {
    savingSetup.value = false
  }
}

// ── Step: languages ─────────────────────────────────────────────────────
const languages = ref<string[]>(['en'])
const defaultLanguage = ref('en')
const placeWording = ref<SitePlaceWording>({})
watch(site, (s) => {
  if (!s) return
  languages.value = [...s.site.languages]
  defaultLanguage.value = s.site.default_language
  placeWording.value = { ...s.site.place_wording }
}, { immediate: true })
const savingLanguages = ref(false)
async function saveLanguages() {
  savingLanguages.value = true
  try {
    if (!languages.value.includes(defaultLanguage.value)) defaultLanguage.value = languages.value[0] ?? 'en'
    await $fetch('/api/pt/site', { method: 'PATCH', body: { languages: languages.value, default_language: defaultLanguage.value, place_wording: placeWording.value } })
    await refreshSite()
    await go('content')
  } catch (err) {
    toast.fail(err)
  } finally {
    savingLanguages.value = false
  }
}

// ── Step: content ────────────────────────────────────────────────────────
const { data: content, refresh: refreshContent } = useFetch<{ libraries: { siteLibraryId: string, libraryId: string | null, title: string, entryCount: number, missingLanguages: string[] }[] }>('/api/pt/content', {
  query: computed(() => ({ campaign: existingCampaign.value?.id })),
  key: 'pt-setup-content',
  immediate: true
})
watch(() => [step.value, existingCampaign.value?.id], () => { if (step.value === 'content' && existingCampaign.value) refreshContent() }, { immediate: true })
async function useLibrary(libraryId: string) {
  try {
    await $fetch('/api/pt/content/libraries', { method: 'POST', body: { campaignId: existingCampaign.value?.id, libraryId } })
    await refreshContent()
    toast.ok('Added to your campaign')
  } catch (err) {
    toast.fail(err)
  }
}
const cadenceOpen = computed(() => {
  if (!meta.value) return false
  const t = meta.value.templates.find(x => x.key === templateKey.value)
  return !t || t.open.includes('cadence')
})
const savingCadence = ref(false)
async function saveCadence(cadence: SetupState['cadence']) {
  if (!existingCampaign.value) return
  setup.value.cadence = cadence
  savingCadence.value = true
  try {
    await $fetch(`/api/pt/campaigns/${existingCampaign.value.id}`, { method: 'PATCH', body: { cadence } })
    await refreshSite()
  } catch (err) {
    toast.fail(err)
  } finally {
    savingCadence.value = false
  }
}
// Personal-start campaigns without a length go through all of their content.
const contentEntries = computed(() => Math.max(0, ...(content.value?.libraries ?? []).map(l => l.entryCount)))
const lengthOpen = computed(() => existingCampaign.value?.start_mode === 'join' && existingCampaign.value.end_mode === 'days')
async function saveLength(length: number | null | undefined) {
  if (!existingCampaign.value) return
  setup.value.length_days = length ?? null
  try {
    await $fetch(`/api/pt/campaigns/${existingCampaign.value.id}`, { method: 'PATCH', body: { length_days: length ?? null } })
    await refreshSite()
  } catch (err) {
    toast.fail(err)
  }
}
const ownTitle = ref('')
const creatingOwn = ref(false)
const editingContent = ref(true)
const prayerEditor = ref<{ dirty: boolean, saving: boolean } | null>(null)
watch(() => content.value?.libraries, (libraries) => {
  if (libraries?.length) editingContent.value = true
}, { immediate: true })
const contentChoice = ref<'library' | 'own'>()
const contentChoices = [
  { value: 'library', label: 'Use an existing guide', description: 'Browse prayer guides and add one to your campaign.' },
  { value: 'own', label: 'Write my own', description: 'Name your guide, then write its prayer entries here.' }
]
const ownGuide = computed(() => content.value?.libraries.find(l => !l.libraryId))
watch(ownGuide, (guide) => {
  if (guide && !contentChoice.value) {
    contentChoice.value = 'own'
    ownTitle.value = guide.title
  }
}, { immediate: true })
const canContinueContent = computed(() => contentChoice.value === 'own'
  ? !!ownGuide.value || !!ownTitle.value.trim()
  : contentChoice.value === 'library' && !!content.value?.libraries.length)
async function saveContentAndContinue() {
  if (creatingOwn.value || !canContinueContent.value) return
  creatingOwn.value = true
  try {
    if (contentChoice.value === 'own' && !ownGuide.value) {
      await $fetch('/api/pt/content/libraries', { method: 'POST', body: { campaignId: existingCampaign.value?.id, title: ownTitle.value.trim() } })
      await refreshContent()
    }
    editingContent.value = true
  } catch (err) {
    toast.fail(err)
  } finally {
    creatingOwn.value = false
  }
}

// ── Step: look and publish ──────────────────────────────────────────────
const color = ref('#2f6f5e')
const image = ref<{ url: string, alt: string, credit: string | null } | null>(null)
const logo = ref<{ url: string, assetId: string | null } | null>(null)
const pickerOpen = ref(false)
const pickerFor = ref<'image' | 'logo'>('image')
function openPicker(target: 'image' | 'logo') {
  pickerFor.value = target
  pickerOpen.value = true
}
watch(site, (s) => {
  if (!s) return
  color.value = s.site.branding?.color ?? s.brand.color
  image.value = s.site.branding?.image_url ? { url: s.site.branding.image_url, alt: s.site.branding.image_alt?.values?.[s.site.default_language] ?? '', credit: s.site.branding.image_credit ?? null } : null
  logo.value = s.site.branding?.logo_url ? { url: s.site.branding.logo_url, assetId: s.site.branding.logo_asset_id ?? null } : null
}, { immediate: true })
const preview = ref<string | null>(null)
const savingLook = ref(false)
async function saveLook(): Promise<boolean> {
  savingLook.value = true
  try {
    const lang = site.value!.site.default_language
    await $fetch('/api/pt/site', {
      method: 'PATCH',
      body: {
        branding: { ...(site.value?.site.branding ?? {}), color: color.value, image_url: image.value?.url, image_alt: image.value && !heroImage(image.value.url) ? { source: lang, values: { [lang]: image.value.alt } } : undefined, image_credit: image.value?.credit ?? undefined, logo_url: logo.value?.url, logo_asset_id: logo.value?.assetId ?? undefined }
      }
    })
    await refreshSite()
    toast.ok('Saved')
    return true
  } catch (err) {
    toast.fail(err)
    return false
  } finally {
    savingLook.value = false
  }
}
async function makePreview() {
  try {
    const res = await $fetch<{ url: string }>('/api/pt/site/preview-link', { method: 'POST' })
    preview.value = res.url
  } catch (err) {
    toast.fail(err)
  }
}
watch(step, (s) => {
  if (s === 'publish' && !preview.value) makePreview()
}, { immediate: true })
async function saveLookAndContinue() {
  if (await saveLook()) await go('landing')
}
const checklist = ref<{ refresh: () => Promise<void>, data: PtChecklist | null } | null>(null)
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
    await checklist.value?.refresh()
  } finally {
    publishing.value = false
  }
}
</script>

<template>
  <div
    class="setup-page mx-auto space-y-8 py-3 sm:py-5"
    :class="step === 'landing' ? 'max-w-[96rem]' : 'max-w-6xl'"
  >
    <div class="space-y-4">
      <p class="text-xs font-semibold uppercase tracking-[0.18em] text-(--ui-primary)">Campaign setup</p>
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
      <p class="text-(--ui-text-muted)">Shape your campaign one step at a time. Your site stays a draft until you publish it.</p>
    </div>

    <div class="setup-workspace">
      <nav class="setup-navigation" aria-label="Campaign setup steps">
        <p class="mb-4 text-xs font-semibold uppercase tracking-wider text-(--ui-text-muted)">Step {{ stepNumber }} of {{ STEPS.length }}</p>
        <ol class="setup-step-list">
          <li v-for="item in stepItems" :key="item.value">
            <button type="button" class="setup-step" :class="{ 'is-current': step === item.value }" :disabled="item.disabled" :aria-current="step === item.value ? 'step' : undefined" @click="go(item.value as Step)">
              <UIcon :name="item.icon" class="size-5 shrink-0" aria-hidden="true" />
              <span class="text-start">
                <span class="block text-sm font-semibold whitespace-nowrap">{{ item.label }}</span>
                <span class="step-description mt-0.5 block text-xs text-(--ui-text-muted)">{{ item.description }}</span>
              </span>
            </button>
          </li>
        </ol>
        <p v-if="!existingCampaign" class="mt-3 text-sm leading-relaxed text-(--ui-text-muted)">Save your campaign to unlock prayer content.</p>
      </nav>
      <div class="setup-content min-w-0">
    <UCard class="setup-panel" v-if="step === 'about'">
      <template #header>
        <h2 class="font-semibold">
          About the site
        </h2>
        <p class="text-sm text-(--ui-text-muted)">
          You can change all of this later.
        </p>
      </template>
      <div class="divide-y divide-(--ui-border-accented)">
        <section class="space-y-4 py-6 first:pt-0 last:pb-0">
          <UFormField
            label="What are you praying for?"
            :ui="{ label: 'text-base font-semibold' }"
          >
            <URadioGroup
              v-model="about.purpose"
              :items="purposeItems"
              variant="card"
              orientation="horizontal"
              class="w-full"
              :ui="{ fieldset: 'grid grid-cols-1 sm:grid-cols-2 gap-3' }"
            />
          </UFormField>
          <UFormField
            v-if="about.purpose === 'people_group'"
            label="Which people group?"
          >
            <UInput
              v-model="about.people_group"
              placeholder="e.g. the Kurds of eastern Turkey"
              class="w-full"
            />
          </UFormField>
        </section>
        <UFormField
          label="Location"
          description="Where the people you pray for are. It places your site on the Prayer.Tools map."
          :ui="{ label: 'text-base font-semibold' }"
          class="py-6 first:pt-0 last:pb-0"
        >
          <PtLocationSearch v-model="location" />
        </UFormField>
        <UFormField
          label="Timezone"
          description="Campaign days begin at midnight in this timezone."
          :ui="{ label: 'text-base font-semibold' }"
          class="py-6 first:pt-0 last:pb-0"
        >
          <USelectMenu
            v-model="about.timezone"
            :items="ptTimezones()"
            class="w-full sm:w-80"
          />
        </UFormField>
      </div>
      <template #footer>
        <div class="flex justify-end">
          <UButton
            label="Save and continue" size="lg" icon="i-lucide-save"
            :loading="savingAbout"
            @click="saveAbout"
          />
        </div>
      </template>
    </UCard>

    <UCard class="setup-panel" v-else-if="step === 'setup'">
      <template #header>
        <h2 class="font-semibold">
          Choose a template
        </h2>
        <p class="text-sm text-(--ui-text-muted)">
          A template fills in sensible answers. You can change them later.
        </p>
      </template>
      <div class="divide-y divide-(--ui-border-accented)">
        <URadioGroup
          :model-value="templateKey"
          :items="templateItems"
          variant="card"
          aria-label="Campaign template"
          :ui="{ fieldset: 'grid grid-cols-1 sm:grid-cols-2 gap-3' }"
          class="pb-6"
          @update:model-value="(value) => chooseTemplate(String(value))"
        />
        <UFormField
          label="Campaign name"
          help="People see this, e.g. “Ramadan 2027”."
          :ui="{ label: 'text-base font-semibold' }"
          class="py-6"
        >
          <UInput
            v-model="campaignName"
            class="w-full"
          />
        </UFormField>
        <PtSetupForm
          v-model="setup"
          :template-key="templateKey"
          :with-cadence="false"
          class="pt-6"
        />
      </div>
      <template #footer>
        <div class="flex justify-end">
          <UButton
            label="Save and continue" size="lg" icon="i-lucide-save"
            :loading="savingSetup"
            :disabled="!!setupDateError"
            @click="saveSetup"
          />
        </div>
      </template>
    </UCard>

    <UCard class="setup-panel" v-else-if="step === 'languages'">
      <template #header>
        <h2 class="font-semibold">
          Languages
        </h2>
      </template>
      <div class="divide-y divide-(--ui-border-accented)">
        <UFormField
          label="Languages the site runs in"
          description="Visitors can switch between these; content should exist in each."
          :ui="{ label: 'text-base font-semibold' }"
          class="py-6 first:pt-0 last:pb-0"
        >
          <PtLanguagePicker
            v-model="languages"
            v-model:default="defaultLanguage"
          />
        </UFormField>
        <UFormField
          v-if="site?.site.place_name"
          label="How your place is written"
          description="Its name in each language, and how to say “in” and “of” it. Prayer guides use these to name your place."
          :ui="{ label: 'text-base font-semibold' }"
          class="py-6 first:pt-0 last:pb-0"
        >
          <PtPlaceWording
            v-model="placeWording"
            :place-name="site.site.place_name"
            :languages="languages"
          />
        </UFormField>
      </div>
      <template #footer>
        <div class="flex justify-end">
          <UButton
            label="Save and continue" size="lg" icon="i-lucide-save"
            :loading="savingLanguages"
            :disabled="!languages.length"
            @click="saveLanguages"
          />
        </div>
      </template>
    </UCard>

    <UCard class="setup-panel" v-else-if="step === 'content'">
      <template #header>
        <h2 class="font-semibold">
          Prayer content
        </h2>
        <p class="text-sm text-(--ui-text-muted)">
          Choose a guide, then write or review its prayer entries before continuing setup.
        </p>
      </template>
      <PtPrayerContentEditor v-if="editingContent" ref="prayerEditor" embedded :initial-campaign-id="existingCampaign?.id" />
      <div v-else class="divide-y divide-(--ui-border-accented)">
        <UFormField
          label="How often is there new prayer content?"
          :help="!cadenceOpen ? 'Set by the template.' : undefined"
          :ui="{ label: 'text-base font-semibold' }"
          class="py-6 first:pt-0 last:pb-0"
        >
          <URadioGroup
            :model-value="setup.cadence"
            :items="PT_CADENCE_ITEMS"
            orientation="horizontal"
            variant="card"
            :disabled="!cadenceOpen || savingCadence || !existingCampaign"
            @update:model-value="(v) => saveCadence(v as SetupState['cadence'])"
          />
        </UFormField>
        <UFormField
          v-if="lengthOpen"
          :label="`How many ${ptUnit(setup.cadence)}s does each person go through? (optional)`"
          :help="contentEntries ? `Leave empty to go through all ${contentEntries} entries.` : 'Leave empty to go through all of the prayer content.'"
          :ui="{ label: 'text-base font-semibold' }"
          class="py-6 first:pt-0 last:pb-0"
        >
          <UInputNumber
            :model-value="setup.length_days"
            :min="1"
            :max="contentEntries || 3650"
            placeholder="All"
            @update:model-value="saveLength"
          />
        </UFormField>
        <section
          v-if="content?.libraries.length"
          class="space-y-2 py-6 first:pt-0 last:pb-0"
        >
          <h3 class="text-base font-semibold">
            In your campaign
          </h3>
          <div
            v-for="l in content.libraries"
            :key="l.siteLibraryId"
            class="flex items-center justify-between rounded-md border border-(--ui-border) px-3 py-2 text-sm"
          >
            <span>{{ l.title }} · {{ l.entryCount }} entries</span>
            <span v-if="!l.entryCount" class="text-(--ui-text-muted)">Ready for prayer entries</span>
            <UBadge
              v-if="l.missingLanguages.length"
              color="warning"
              variant="soft"
              :label="`Missing: ${l.missingLanguages.map(x => languageName(meta, x)).join(', ')}`"
            />
          </div>
        </section>
        <section class="space-y-4 py-6 first:pt-0 last:pb-0">
          <h3 class="text-base font-semibold">
            How would you like to add your prayer guide?
          </h3>
          <URadioGroup v-model="contentChoice" :items="contentChoices" variant="card" />
          <PtLibraryCatalog
            v-if="contentChoice === 'library'"
            :template="templateKey"
            :cadence="existingCampaign?.cadence"
            :site-languages="site?.site.languages ?? []"
            :used-ids="(content?.libraries ?? []).map(l => l.libraryId).filter(Boolean) as string[]"
            @use="useLibrary"
          />
          <div v-if="contentChoice === 'own'" class="space-y-2">
            <p class="text-sm text-(--ui-text-muted)">{{ ownGuide ? 'Your guide is saved. Continue below to write its prayer entries here.' : 'Give your guide a name. Continue below to create it and write its prayer entries here.' }}</p>
            <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
            <UFormField
              label="Prayer guide name"
              class="min-w-0 flex-1"
            >
              <UInput
                v-model="ownTitle"
                :disabled="!!ownGuide"
                placeholder="Our prayer guide"
                size="lg"
                :ui="{ base: 'h-11' }"
                class="w-full"
              />
            </UFormField>
            </div>
          </div>
        </section>
      </div>
      <template #footer>
        <div class="flex justify-end">
          <UButton
            :label="editingContent ? 'Save and continue' : 'Continue to prayer entries'"
            size="lg" icon="i-lucide-save"
            :loading="creatingOwn"
            :disabled="editingContent ? !!prayerEditor?.dirty || !!prayerEditor?.saving : !canContinueContent"
            @click="editingContent ? go('look') : saveContentAndContinue()"
          />
        </div>
        <p v-if="editingContent && prayerEditor?.dirty" class="mt-2 text-right text-sm text-(--ui-text-muted)">Save your current prayer entry before continuing.</p>
      </template>
    </UCard>

    <UCard class="setup-panel" v-else-if="step === 'look'">
      <template #header>
        <h2 class="font-semibold">
          Look
        </h2>
      </template>
      <div class="space-y-6">
        <div class="divide-y divide-(--ui-border-accented)">
          <PtColorField
            v-model="color"
            :ui="{ label: 'text-base font-semibold' }"
            class="py-6 first:pt-0 last:pb-0"
          />
          <div class="grid sm:grid-cols-2 gap-6 py-6 first:pt-0 last:pb-0">
            <UFormField
              label="Hero image"
              description="A wide photo shown behind the top of your page, tinted with your color."
              :ui="{ label: 'text-base font-semibold' }"
            >
              <div class="space-y-2">
                <img
                  v-if="image"
                  :src="image.url"
                  :alt="image.alt"
                  class="rounded-md max-h-32 object-cover"
                >
                <UButton
                  :label="image ? 'Change image' : 'Choose image'"
                  icon="i-lucide-image"
                  variant="soft"
                  @click="openPicker('image')"
                />
              </div>
            </UFormField>
            <UFormField
              label="Logo (optional)"
              description="Shown in emails and the site header."
              :ui="{ label: 'text-base font-semibold' }"
            >
              <div class="space-y-2">
                <img
                  v-if="logo"
                  :src="logo.url"
                  alt=""
                  class="rounded-md max-h-20 object-contain"
                >
                <div class="flex flex-wrap gap-2">
                  <UButton
                    :label="logo ? 'Change logo' : 'Choose logo'"
                    icon="i-lucide-image"
                    variant="soft"
                    @click="openPicker('logo')"
                  />
                  <UButton
                    v-if="logo"
                    label="Remove"
                    icon="i-lucide-x"
                    color="neutral"
                    variant="ghost"
                    @click="logo = null"
                  />
                </div>
              </div>
            </UFormField>
          </div>
        </div>
        <div class="flex justify-end">
          <UButton
            label="Save and continue" size="lg" icon="i-lucide-save"
            :loading="savingLook"
            @click="saveLookAndContinue"
          />
        </div>
      </div>
    </UCard>

    <PtLandingEditor
      v-else-if="step === 'landing'"
      save-label="Save and continue"
      @saved="go('publish')"
    >
      <template #heading>
        <h2 class="font-semibold">
          Landing page
        </h2>
        <p class="text-sm text-(--ui-text-muted)">
          Write the parts that are yours and hide what you don't need. The preview shows your page with its look as you edit.
        </p>
      </template>
    </PtLandingEditor>

    <div
      v-else-if="step === 'publish'"
      class="space-y-6"
    >
      <PtLaunchChecklist ref="checklist" within-setup @fix="fixSetupItem" />

      <UCard class="setup-panel" v-if="preview">
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
              see the draft. Save to see your latest changes.
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
        v-if="can('pt.site.manage')"
        class="flex items-center gap-3 flex-wrap"
      >
        <UButton
          size="xl"
          icon="i-lucide-rocket"
          label="Publish site"
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
    </div>

    <PtImagePicker
      v-model:open="pickerOpen"
      :language="site?.site.default_language"
      :hero-for="pickerFor === 'image' ? templateKey : undefined"
      @hero="(url) => { image = { url, alt: '', credit: null }; pickerOpen = false }"
      @select="(a) => { if (pickerFor === 'logo') logo = { url: a.url, assetId: a.asset.id }; else image = { url: a.url, alt: a.alt, credit: a.credit }; pickerOpen = false }"
    />
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
.setup-content :deep(.setup-continue) {
  min-height: 3rem;
  padding: 0.8rem 1.5rem;
  color: #ffffff;
  font-size: 0.95rem;
  font-weight: 650;
}
@media (min-width: 1200px) {
  .setup-workspace { grid-template-columns: 15rem minmax(0, 1fr); gap: 2rem; }
  .setup-navigation { position: sticky; top: 5.5rem; align-self: start; }
  .setup-step-list { flex-direction: column; overflow: visible; }
  .setup-step { width: 100%; padding: 1rem; }
  .step-description { display: block; }
}
:global(.dark) .setup-step.is-current { background: #472f1d; color: #ffb376; }
</style>
