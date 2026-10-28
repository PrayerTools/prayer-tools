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

definePageMeta({ middleware: 'auth' })

const STEPS = ['about', 'setup', 'languages', 'content', 'look', 'landing', 'publish'] as const
type Step = typeof STEPS[number]

const { data: site, refresh: refreshSite, can } = usePtSite()
const { data: meta } = usePtMeta()
const toast = usePtToast()
const route = useRoute()
const slug = computed(() => String(route.params.orgSlug))

const step = ref<Step>('about')
watch(site, (s) => {
  const saved = s?.site.onboarding?.step as Step | undefined
  if (saved && STEPS.includes(saved) && step.value === 'about') step.value = saved
}, { immediate: true })

async function go(next: Step) {
  step.value = next
  await $fetch('/api/pt/site', { method: 'PATCH', body: { onboarding: { step: next } } }).catch(() => {})
}

const contentSetup = ref<{ save: () => Promise<boolean> } | null>(null)
async function continueFromContent() {
  if (await contentSetup.value?.save() !== false) await go('look')
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
async function saveSetup() {
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
  const hero = s.currentCampaign?.branding
  image.value = hero?.image_url ? { url: hero.image_url, alt: hero.image_alt?.values?.[s.site.default_language] ?? '', credit: hero.image_credit ?? null } : null
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
        branding: { ...(site.value?.site.branding ?? {}), color: color.value, logo_url: logo.value?.url, logo_asset_id: logo.value?.assetId ?? undefined }
      }
    })
    if (existingCampaign.value) {
      await $fetch(`/api/pt/campaigns/${existingCampaign.value.id}`, {
        method: 'PATCH',
        body: {
          branding: { image_url: image.value?.url, image_alt: image.value && !heroImage(image.value.url) ? { source: lang, values: { [lang]: image.value.alt } } : undefined, image_credit: image.value?.credit ?? undefined }
        }
      })
    }
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
    class="mx-auto space-y-6"
    :class="step === 'landing' ? 'max-w-[96rem]' : 'max-w-3xl'"
  >
    <div class="max-w-3xl mx-auto space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-semibold">
          Set up {{ site?.org.name }}
        </h1>
        <UBadge
          :label="PT_LABELS.siteStatus[site?.site.status ?? 'draft']"
          :color="ptStatusColor(site?.site.status ?? 'draft')"
          variant="subtle"
        />
      </div>
      <UTabs
        :model-value="step"
        :items="[
          { label: 'About', value: 'about', icon: 'i-lucide-info' },
          { label: 'Campaign', value: 'setup', icon: 'i-lucide-calendar-range' },
          { label: 'Languages', value: 'languages', icon: 'i-lucide-languages' },
          { label: 'Content', value: 'content', icon: 'i-lucide-book-open', disabled: !existingCampaign },
          { label: 'Look', value: 'look', icon: 'i-lucide-palette' },
          { label: 'Landing page', value: 'landing', icon: 'i-lucide-panels-top-left' },
          { label: 'Publish', value: 'publish', icon: 'i-lucide-rocket' }
        ]"
        :content="false"
        class="w-full"
        @update:model-value="(v) => go(v as Step)"
      />
    </div>

    <UCard v-if="step === 'about'">
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
              :ui="{ fieldset: 'grid grid-cols-1 sm:grid-cols-2 gap-2' }"
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
            label="Save and continue"
            :loading="savingAbout"
            @click="saveAbout"
          />
        </div>
      </template>
    </UCard>

    <UCard v-else-if="step === 'setup'">
      <template #header>
        <h2 class="font-semibold">
          Choose a template
        </h2>
        <p class="text-sm text-(--ui-text-muted)">
          A template fills in sensible answers. You can change them later.
        </p>
      </template>
      <div class="divide-y divide-(--ui-border-accented)">
        <div class="grid sm:grid-cols-2 gap-3 pb-6">
          <button
            v-for="t in meta?.templates ?? []"
            :key="t.key"
            type="button"
            class="text-start rounded-lg border p-3 transition focus-visible:ring-2 focus-visible:ring-(--ui-primary)"
            :class="templateKey === t.key ? 'border-(--ui-primary) ring-1 ring-(--ui-primary) bg-(--ui-bg-elevated)' : 'border-(--ui-border) hover:bg-(--ui-bg-elevated)'"
            @click="chooseTemplate(t.key)"
          >
            <span class="flex items-center gap-2">
              <UIcon
                :name="PT_TEMPLATE_ICONS[t.key] ?? 'i-lucide-sparkles'"
                class="size-5 shrink-0 text-(--ui-primary)"
              />
              <span class="font-medium">{{ PT_LABELS.template[t.key] }}</span>
            </span>
            <span class="block text-sm text-(--ui-text-muted) mt-1">{{ PT_LABELS.templateDescription[t.key] }}</span>
          </button>
        </div>
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
            label="Save and continue"
            :loading="savingSetup"
            @click="saveSetup"
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
            label="Save and continue"
            :loading="savingLanguages"
            :disabled="!languages.length"
            @click="saveLanguages"
          />
        </div>
      </template>
    </UCard>

    <UCard v-else-if="step === 'content'">
      <template #header>
        <h2 class="font-semibold">
          Prayer content
        </h2>
        <p class="text-sm text-(--ui-text-muted)">
          Use a library as it is (fixes and new translations reach you automatically), change it to suit
          your site, or write your own.
        </p>
      </template>
      <PtCampaignContentSetup
        v-if="existingCampaign"
        ref="contentSetup"
        :campaign="existingCampaign"
        :template-key="templateKey"
        @changed="refreshSite"
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

    <UCard v-else-if="step === 'look'">
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
            label="Save and continue"
            :loading="savingLook"
            @click="saveLookAndContinue"
          />
        </div>
      </div>
    </UCard>

    <PtLandingEditor
      v-else-if="step === 'landing' && existingCampaign"
      :campaign-id="existingCampaign.id"
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
      <PtLaunchChecklist ref="checklist" />

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

    <PtImagePicker
      v-model:open="pickerOpen"
      :language="site?.site.default_language"
      :hero-for="pickerFor === 'image' ? templateKey : undefined"
      @hero="(url) => { image = { url, alt: '', credit: null }; pickerOpen = false }"
      @select="(a) => { if (pickerFor === 'logo') logo = { url: a.url, assetId: a.asset.id }; else image = { url: a.url, alt: a.alt, credit: a.credit }; pickerOpen = false }"
    />
  </div>
</template>
