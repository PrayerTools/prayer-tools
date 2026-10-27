<script setup lang="ts">
// Site settings: general (details, languages, behaviour), look, email,
// contact form, wording, and status (publishing, directory, exports, deleting).
// Only values that differ from the code defaults are stored.
import type { TranslatableText } from '@prayertools/shared/db/schema'
import { DEFAULT_BRAND_COLOR } from '@prayertools/shared/colors'
import { heroImage } from '@prayertools/shared/hero-images'
import type { SitePlaceWording } from '@prayertools/shared/place'
import type { PtLocation } from '../../../components/PtLocationSearch.vue'

definePageMeta({ middleware: 'auth' })

const { data: site, refresh, can, isOwner } = usePtSite()
const { data: meta } = usePtMeta()
const toast = usePtToast()
const route = useRoute()
const router = useRouter()

const tabs = computed(() => [
  { label: 'General', value: 'details', icon: 'i-lucide-info' },
  { label: 'Look', value: 'look', icon: 'i-lucide-palette' },
  ...(can('pt.site.manage') ? [{ label: 'Email', value: 'email', icon: 'i-lucide-mail' }] : []),
  { label: 'Contact form', value: 'contact', icon: 'i-lucide-message-square' },
  { label: 'Wording', value: 'wording', icon: 'i-lucide-type' },
  ...(can('pt.site.manage') ? [{ label: 'Status', value: 'status', icon: 'i-lucide-power' }] : [])
])
// Section names accepted in ?tab=, opening the tab that holds that section.
const TAB_ALIASES: Record<string, string> = { languages: 'details', behaviour: 'details', sending: 'email' }
// The signup form has its own page under Landing.
if (route.query.tab === 'signup') await navigateTo('/site/landing/signup-form', { replace: true })
const tab = computed({
  get: () => {
    const t = String(route.query.tab ?? 'details')
    return TAB_ALIASES[t] ?? t
  },
  set: v => router.replace({ query: { ...route.query, tab: v } })
})
const TAB_INTRO: Record<string, string> = {
  details: 'What your site is about, its languages and how it behaves.',
  look: 'Your site’s colors and images.',
  email: 'How reminders and site emails appear in people’s inboxes, and where replies go.',
  contact: 'What your contact form asks, and who is notified of new messages.',
  wording: 'Change the standard wording on your site. Leave a field empty to use the standard wording.',
  status: 'Publish or archive the site, list it in the Prayer.Tools directory, or delete it.'
}

async function patchSite(body: Record<string, unknown>, message = 'Saved') {
  try {
    await $fetch('/api/pt/site', { method: 'PATCH', body })
    await refresh()
    if (message) toast.ok(message)
    return true
  } catch (err) {
    toast.fail(err)
    return false
  }
}

// Details
const details = reactive({ name: '', purpose: 'place', place_name: '', place_wording: {} as SitePlaceWording, people_group: '', latitude: null as number | null, longitude: null as number | null })
const location = computed<PtLocation | null>({
  get: () => details.place_name ? { name: details.place_name, latitude: details.latitude, longitude: details.longitude } : null,
  set: (v) => { Object.assign(details, { place_name: v?.name ?? '', latitude: v?.latitude ?? null, longitude: v?.longitude ?? null }) }
})
// Languages and time zone
const languages = ref<string[]>([])
const defaultLanguage = ref('en')
const timezone = ref('UTC')
// Look
const branding = ref<Record<string, any>>({})
const imagePicker = ref<'image' | 'logo' | null>(null)
// Sending
const identity = ref<Record<string, any>>({})
const signature = ref<TranslatableText | null>(null)
// Behaviour
const settings = ref<Record<string, any>>({})

function resetLook() {
  const s = site.value
  if (!s) return
  branding.value = { ...s.site.branding }
}
function resetEmail() {
  const s = site.value
  if (!s) return
  identity.value = { ...s.site.email_identity }
  signature.value = s.site.email_identity?.signature ?? null
}

type Site = NonNullable<typeof site.value>
function detailsOf(s: Site) {
  return { name: s.org.name, purpose: s.site.purpose ?? 'place', place_name: s.site.place_name ?? '', place_wording: { ...s.site.place_wording }, people_group: s.site.people_group ?? '', latitude: s.site.latitude, longitude: s.site.longitude }
}
function languagesOf(s: Site) {
  return { languages: [...s.site.languages], default_language: s.site.default_language, timezone: s.site.timezone }
}
function languagesNow() {
  return { languages: languages.value, default_language: defaultLanguage.value, timezone: timezone.value }
}
function resetLanguages() {
  const s = site.value
  if (!s) return
  languages.value = [...s.site.languages]
  defaultLanguage.value = s.site.default_language
  timezone.value = s.site.timezone
}
// Compares form values ignoring key order and empty values, so an untouched form never counts as changed.
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return x
    const o = x as Record<string, unknown>
    return Object.fromEntries(Object.keys(o).sort().filter(k => o[k] !== undefined && o[k] !== null && o[k] !== '').map(k => [k, o[k]]))
  })
}

const purposeItems = computed(() => Object.entries(PT_LABELS.purpose).map(([value, label]) => ({ value, label, description: PT_LABELS.purposeDescription[value] })))

// Behaviour: booleans save on toggle; numbers save with the rest of General.
function settingValue(key: string) {
  return settings.value[key] ?? meta.value?.settingDefaults[key]
}
const savingSetting = ref<string | null>(null)
async function saveSetting(key: string, value: boolean | number | null) {
  savingSetting.value = key
  await patchSite({ settings: { [key]: value ?? meta.value?.settingDefaults[key] } })
  savingSetting.value = null
}
const numberSettings = computed(() => Object.entries(meta.value?.settingDefaults ?? {}).filter(([, def]) => typeof def === 'number').map(([key]) => key))
const booleanSettings = computed(() => Object.entries(meta.value?.settingDefaults ?? {}).filter(([, def]) => typeof def === 'boolean').map(([key]) => key))
const numberDraft = ref<Record<string, number | null>>({})
function resetNumbers() {
  numberDraft.value = Object.fromEntries(numberSettings.value.map(k => [k, settingValue(k) as number]))
}
watch(meta, resetNumbers, { immediate: true })

// General: the about, languages and number settings save together.
const detailsDirty = computed(() => !!site.value && canonical(details) !== canonical(detailsOf(site.value)))
const languagesDirty = computed(() => !!site.value && canonical(languagesNow()) !== canonical(languagesOf(site.value)))
const numbersDirty = computed(() => numberSettings.value.some(k => numberDraft.value[k] !== settingValue(k)))
const generalDirty = computed(() => detailsDirty.value || languagesDirty.value || numbersDirty.value)
const languagesValid = computed(() => languages.value.length > 0 && languages.value.includes(defaultLanguage.value))
const savingGeneral = ref(false)
async function saveGeneral() {
  savingGeneral.value = true
  const ok = await patchSite({
    ...(detailsDirty.value ? { ...details, place_name: details.place_name || null, people_group: details.people_group || null } : {}),
    ...(languagesDirty.value ? { languages: languages.value, default_language: defaultLanguage.value, timezone: timezone.value } : {}),
    ...(numbersDirty.value ? { settings: Object.fromEntries(numberSettings.value.map(k => [k, numberDraft.value[k] ?? meta.value?.settingDefaults[k]])) } : {})
  })
  if (ok) resetGeneral()
  savingGeneral.value = false
}
function resetGeneral() {
  if (site.value) Object.assign(details, detailsOf(site.value))
  resetLanguages()
  resetNumbers()
}

// When a save reloads the site, sections without unsaved edits take the new values.
watch(site, (s, prev) => {
  if (!s) return
  if (!prev || canonical(details) === canonical(detailsOf(prev))) Object.assign(details, detailsOf(s))
  if (!prev || canonical(languagesNow()) === canonical(languagesOf(prev))) resetLanguages()
  if (!prev || comparable(branding.value) === comparable(prev.site.branding)) resetLook()
  if (!prev || comparable({ ...identity.value, signature: signature.value }) === comparable(prev.site.email_identity)) resetEmail()
  const numbersClean = !prev || !numbersDirty.value
  settings.value = { ...s.site.settings }
  if (numbersClean) resetNumbers()
}, { immediate: true })

// Look
const brandColor = computed({
  get: () => branding.value.color ?? DEFAULT_BRAND_COLOR,
  // The default color is not stored, so choosing it clears the override.
  set: (v: string) => { branding.value.color = v.toLowerCase() === DEFAULT_BRAND_COLOR ? undefined : v }
})
const IMAGE_SLOTS = [
  { slot: 'logo', key: 'logo_url', label: 'Logo', help: 'Shown at the top of your site and emails. Without one, the site name is shown.' },
  { slot: 'image', key: 'image_url', label: 'Hero image', help: 'Shown behind the top of your landing page, tinted with your color.' }
] as const
function comparable(o: Record<string, unknown> | null | undefined) {
  return JSON.stringify(Object.keys(o ?? {}).sort().filter(k => o![k] !== undefined && o![k] !== null && o![k] !== '').map(k => [k, o![k]]))
}
const brandingDirty = computed(() => comparable(branding.value) !== comparable(site.value?.site.branding))
const savingLook = ref(false)
async function saveLook() {
  savingLook.value = true
  if (await patchSite({ branding: branding.value })) resetLook()
  savingLook.value = false
}

// Email
const emailDirty = computed(() => comparable({ ...identity.value, signature: signature.value }) !== comparable(site.value?.site.email_identity))
const savingEmail = ref(false)
async function saveEmail() {
  savingEmail.value = true
  if (await patchSite({ email_identity: { ...identity.value, signature: signature.value } })) resetEmail()
  savingEmail.value = false
}

// Wording
// Landing page headings and text are edited on the Landing page.
const EDITABLE: { key: string, label: string, multiline?: boolean }[] = [
  { key: 'share.default_message', label: 'Default share message', multiline: true },
  { key: 'signup.success', label: 'Message after signing up', multiline: true },
  { key: 'between.notify_intro', label: 'Between campaigns: “notify me” text', multiline: true }
]
const { data: strings, refresh: refreshStrings } = useFetch<{ strings: { key: string, language: string, value: string }[] }>('/api/pt/strings', { key: 'pt-strings' })
const wordingLang = ref('en')
watch(site, (s) => {
  if (s) wordingLang.value = s.site.default_language
}, { immediate: true })
const wording = ref<Record<string, string>>({})
const savedWording = computed<Record<string, string>>(() => Object.fromEntries((strings.value?.strings ?? []).filter(s => s.language === wordingLang.value).map(s => [s.key, s.value])))
function resetWording() {
  wording.value = { ...savedWording.value }
}
watch(savedWording, resetWording, { immediate: true })
const changedWording = computed(() => EDITABLE.map(e => e.key).filter(k => (wording.value[k] ?? '') !== (savedWording.value[k] ?? '')))
const wordingDirty = computed(() => changedWording.value.length > 0)
// Switching language asks first when the current language has unsaved edits.
const wordingLangModel = computed({
  get: () => wordingLang.value,
  set: (v: string) => {
    allowLeave().then((ok) => {
      if (ok) wordingLang.value = v
    })
  }
})
const savingWording = ref(false)
async function saveWording() {
  savingWording.value = true
  try {
    for (const key of changedWording.value) {
      await $fetch('/api/pt/strings', { method: 'PUT', body: { key, language: wordingLang.value, value: wording.value[key] ?? '' } })
    }
    await refreshStrings()
    toast.ok('Saved')
  } catch (err) {
    toast.fail(err)
  } finally {
    savingWording.value = false
  }
}

// Status
const previewUrl = ref<string | null>(null)
const statusBusy = ref(false)
const archiveOpen = ref(false)
async function setStatus(action: string) {
  statusBusy.value = true
  try {
    await $fetch('/api/pt/site/status', { method: 'POST', body: { action } })
    await refresh()
    archiveOpen.value = false
    toast.ok(action === 'publish' ? 'Site published' : action === 'archive' ? 'Site archived' : 'Site un-archived')
  } catch (err) {
    toast.fail(err, 'Could not change the status')
  } finally {
    statusBusy.value = false
  }
}
async function preview() {
  const res = await $fetch<{ url: string }>('/api/pt/site/preview-link', { method: 'POST' })
  previewUrl.value = res.url
}
async function copy(text: string) {
  await navigator.clipboard.writeText(text)
  toast.ok('Copied')
}
const directoryBusy = ref(false)
async function directory(listed: boolean) {
  directoryBusy.value = true
  try {
    await $fetch('/api/pt/directory', { method: 'POST', body: { listed } })
    await refresh()
    toast.ok(listed ? 'Listing requested' : 'Removed from the directory')
  } catch (err) {
    toast.fail(err)
  } finally {
    directoryBusy.value = false
  }
}
const DIRECTORY_TEXT: Record<string, string> = {
  none: 'Ask to list your site in the Prayer.Tools directory and app so more people find it. A Prayer.Tools operator approves listings.',
  requested: 'A Prayer.Tools team member will review your site before it appears in the directory.',
  listed: 'Your site appears in the Prayer.Tools directory and the app.',
  unlisted: 'Your site is not in the directory. It stays reachable by its link.'
}
const deleteConfirm = ref('')
const deleteOpen = ref(false)
async function deleteSite() {
  try {
    await $fetch('/api/pt/site', { method: 'DELETE', body: { confirm: deleteConfirm.value } })
    await navigateTo('/orgs')
  } catch (err) {
    toast.fail(err)
  }
}
// Unsaved edits on the open tab block switching tabs or leaving the page.
const contactForm = useTemplateRef<{ dirty: boolean, reset: () => void }>('contactForm')
const TAB_EDITS: Record<string, { dirty: () => boolean, discard: () => void }> = {
  details: { dirty: () => generalDirty.value, discard: resetGeneral },
  look: { dirty: () => brandingDirty.value, discard: resetLook },
  email: { dirty: () => emailDirty.value, discard: resetEmail },
  contact: { dirty: () => !!contactForm.value?.dirty, discard: () => contactForm.value?.reset() },
  wording: { dirty: () => wordingDirty.value, discard: resetWording }
}
const allowLeave = usePtUnsavedGuard(() => !!TAB_EDITS[tab.value]?.dirty(), () => TAB_EDITS[tab.value]?.discard())

const { data: exportsLog } = useFetch<{ exports: { id: string, row_count: number, created_at: string, display_name: string, email: string }[] }>('/api/pt/exports', { key: 'pt-exports', immediate: false })
watch(tab, (t) => {
  if (t === 'status' && can('pt.site.manage')) refreshNuxtData('pt-exports')
}, { immediate: true })
</script>

<template>
  <div
    v-if="site"
    class="max-w-4xl mx-auto space-y-6"
  >
    <PtSettingsTabs />
    <header>
      <h1 class="text-2xl font-bold">
        Settings
      </h1>
      <p class="text-sm text-muted max-w-2xl">
        {{ TAB_INTRO[tab] }}
      </p>
    </header>
    <UTabs
      v-model="tab"
      :items="tabs"
      :content="false"
      activation-mode="manual"
      class="w-full"
    />

    <UAlert
      v-if="!can('pt.site.write') && tab !== 'wording' && tab !== 'contact'"
      color="neutral"
      variant="subtle"
      icon="i-lucide-lock"
      title="Only owners and editors can change these settings."
    />

    <template v-if="tab === 'details'">
      <UCard>
        <template #header>
          <h2 class="font-semibold">
            About the site
          </h2>
        </template>
        <form
          @submit.prevent="saveGeneral"
        >
          <fieldset
            :disabled="!can('pt.site.write')"
            class="space-y-5"
          >
            <UFormField label="Site name">
              <UInput
                v-model="details.name"
                maxlength="80"
                class="w-full"
              />
            </UFormField>
            <UFormField label="What are you praying for?">
              <URadioGroup
                v-model="details.purpose"
                :items="purposeItems"
                orientation="horizontal"
                variant="card"
                class="w-full"
                :ui="{ fieldset: 'grid grid-cols-1 sm:grid-cols-2 gap-2' }"
              />
            </UFormField>
            <UFormField
              label="Location"
              description="Where the people you pray for are. Its name fills content placeholders like {place}."
            >
              <PtLocationSearch v-model="location" />
            </UFormField>
            <UFormField
              v-if="details.place_name"
              label="How your place is written"
              description="Its name in each language, and how to say “in” and “of” it."
            >
              <PtPlaceWording
                v-model="details.place_wording"
                :place-name="details.place_name"
                :languages="site.site.languages"
                :disabled="!can('pt.site.write')"
              />
            </UFormField>
            <UFormField label="People group">
              <UInput
                v-model="details.people_group"
                class="w-full"
              />
            </UFormField>
          </fieldset>
        </form>
      </UCard>

      <UCard>
        <div class="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 class="font-semibold">
              Dates, goal and content
            </h2>
            <p class="text-sm text-muted">
              Each campaign has its own start, end, goal and rhythm.
            </p>
          </div>
          <UButton
            to="/site/campaigns"
            variant="outline"
            color="neutral"
            icon="i-lucide-calendar-range"
            label="Campaigns"
          />
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Languages and time zone
          </h2>
        </template>
        <fieldset
          :disabled="!can('pt.site.write')"
          class="space-y-5"
        >
          <UFormField
            label="Languages"
            description="The public site's language switcher, signup languages, and which languages content should exist in."
          >
            <PtLanguagePicker
              v-model="languages"
              v-model:default="defaultLanguage"
              :disabled="!can('pt.site.write')"
            />
          </UFormField>
          <UFormField
            label="Time zone"
            description="Used for campaign dates and the daily schedule."
          >
            <USelectMenu
              v-model="timezone"
              :items="ptTimezones()"
              class="w-full sm:w-72"
            />
          </UFormField>
        </fieldset>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Site settings
          </h2>
        </template>
        <div class="space-y-4">
          <USwitch
            v-for="key in booleanSettings"
            :key="key"
            :model-value="settingValue(key)"
            :label="PT_LABELS.setting[key] ?? key"
            :loading="savingSetting === key"
            :disabled="!can('pt.site.write')"
            @update:model-value="(v: boolean) => saveSetting(key, v)"
          />
          <UFormField
            v-for="key in numberSettings"
            :key="key"
            :label="PT_LABELS.setting[key] ?? key"
          >
            <div class="flex items-center gap-2">
              <UInputNumber
                v-model="numberDraft[key]"
                :min="1"
                :max="240"
                :disabled="!can('pt.site.write')"
              />
            </div>
          </UFormField>
        </div>
      </UCard>

      <PtSaveBar
        v-if="can('pt.site.write')"
        :dirty="generalDirty"
        :saving="savingGeneral"
        :disabled="!languagesValid"
        @save="saveGeneral"
        @discard="resetGeneral"
      />
    </template>

    <template v-else-if="tab === 'look'">
      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Branding
          </h2>
          <p class="text-sm text-muted">
            Your color is used for buttons and highlights on your site and in emails.
          </p>
        </template>
        <fieldset
          :disabled="!can('pt.site.write')"
          class="space-y-6"
        >
          <PtColorField v-model="brandColor" />

          <div class="grid gap-6 sm:grid-cols-2">
            <UFormField
              v-for="s in IMAGE_SLOTS"
              :key="s.slot"
              :label="s.label"
              :description="s.help"
            >
              <div class="space-y-2">
                <div
                  v-if="branding[s.key]"
                  class="rounded-md overflow-hidden border border-default"
                  :class="s.slot === 'logo' ? 'h-32 bg-elevated p-4' : 'aspect-video'"
                >
                  <img
                    :src="branding[s.key]"
                    alt=""
                    class="size-full"
                    :class="s.slot === 'logo' ? 'object-contain' : 'object-cover'"
                    :style="s.slot === 'image' ? { objectPosition: `${(branding.focal_x ?? 0.5) * 100}% ${(branding.focal_y ?? 0.5) * 100}%` } : {}"
                  >
                </div>
                <div
                  v-else
                  class="h-32 rounded-md border border-dashed border-accented flex flex-col items-center justify-center gap-1 text-muted"
                >
                  <UIcon
                    name="i-lucide-image"
                    class="size-6"
                  />
                  <span class="text-xs">No image yet</span>
                </div>
                <div class="flex gap-2">
                  <UButton
                    size="sm"
                    variant="soft"
                    icon="i-lucide-image"
                    :label="branding[s.key] ? 'Change' : 'Choose'"
                    @click="imagePicker = s.slot"
                  />
                  <UButton
                    v-if="branding[s.key]"
                    size="sm"
                    variant="ghost"
                    color="neutral"
                    icon="i-lucide-x"
                    label="Remove"
                    @click="branding[s.key] = undefined"
                  />
                </div>
              </div>
            </UFormField>
          </div>

          <div
            v-if="branding.image_url"
            class="space-y-5 border-t border-default pt-5"
          >
            <UFormField
              label="Focal point of the hero image"
              description="Keeps the important part visible when phones crop the image."
            >
              <div class="grid grid-cols-2 gap-4 max-w-md">
                <USlider
                  v-model="branding.focal_x"
                  :min="0"
                  :max="1"
                  :step="0.05"
                  aria-label="Horizontal focal point"
                />
                <USlider
                  v-model="branding.focal_y"
                  :min="0"
                  :max="1"
                  :step="0.05"
                  aria-label="Vertical focal point"
                />
              </div>
            </UFormField>
            <template v-if="!heroImage(branding.image_url)">
              <PtTranslatableInput
                v-model="branding.image_alt"
                :languages="site.site.languages"
                :default-language="site.site.default_language"
                label="Image description (alt text)"
                required
              />
              <UFormField label="Image credit (shown under the image)">
                <UInput
                  v-model="branding.image_credit"
                  class="w-full"
                />
              </UFormField>
            </template>
          </div>
          <p class="text-xs text-muted">
            The image for link previews is on the
            <ULink
              to="/site/landing/share"
              class="underline"
            >Share</ULink> page.
          </p>
        </fieldset>
      </UCard>

      <PtSaveBar
        v-if="can('pt.site.write')"
        :dirty="brandingDirty"
        :saving="savingLook"
        label="Save look"
        @save="saveLook"
        @discard="resetLook"
      />
    </template>

    <template v-else-if="tab === 'email' && can('pt.site.manage')">
      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Email identity
          </h2>
          <p class="text-sm text-muted">
            How reminders and site emails appear in people's inboxes. They are sent from a Prayer.Tools address with your
            site's name, and replies go to you.
          </p>
        </template>
        <div class="space-y-5">
          <div class="grid sm:grid-cols-2 gap-4">
            <UFormField
              label="From name"
              :description="`Leave empty to use “${site.org.name}”.`"
            >
              <UInput
                v-model="identity.from_name"
                :placeholder="site.org.name"
                maxlength="80"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Sending address"
              description="Before the @ of the Prayer.Tools sending domain."
            >
              <UInput
                v-model="identity.from_local"
                :placeholder="site.org.slug"
                class="w-full font-mono"
              />
            </UFormField>
            <UFormField
              label="Reply-to address"
              :description="site.inboxAddress ? `Leave empty to get replies in this site's inbox (${site.inboxAddress}).` : 'Replies to your emails go here.'"
            >
              <UInput
                v-model="identity.reply_to"
                type="email"
                :placeholder="site.inboxAddress ?? 'you@example.com'"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Logo in emails (URL)"
              description="Leave empty to use your site logo."
            >
              <UInput
                v-model="identity.logo_url"
                :placeholder="branding.logo_url"
                class="w-full"
              />
            </UFormField>
          </div>
          <PtTranslatableInput
            v-model="signature"
            :languages="site.site.languages"
            :default-language="site.site.default_language"
            label="Email signature"
            help="Added to the end of your emails, in each language."
            multiline
          />
          <UAlert
            color="neutral"
            variant="subtle"
            icon="i-lucide-info"
            description="Sending from your own domain (with DKIM/SPF records) is planned; for now all mail uses the Prayer.Tools domain so bounces and complaints are tracked."
          />
        </div>
      </UCard>

      <PtSaveBar
        :dirty="emailDirty"
        :saving="savingEmail"
        label="Save email"
        @save="saveEmail"
        @discard="resetEmail"
      />
    </template>

    <PtContactFormSettings
      v-else-if="tab === 'contact'"
      ref="contactForm"
    />

    <template v-else-if="tab === 'wording'">
      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <h2 class="font-semibold">
              Wording on your site
            </h2>
            <USelect
              v-model="wordingLangModel"
              :items="site.site.languages.map(l => ({ label: languageName(meta, l), value: l }))"
              class="w-44"
            />
          </div>
        </template>
        <div class="space-y-4">
          <p class="text-sm text-(--ui-text-muted)">
            Headings and text on the landing page are edited on the
            <ULink
              :to="`/@${site.org.slug}/site/landing`"
              class="text-(--ui-primary)"
            >Landing page</ULink>.
          </p>
          <div
            v-for="e in EDITABLE"
            :key="e.key"
            class="flex items-end gap-2"
          >
            <UFormField
              :label="e.label"
              class="flex-1"
            >
              <UTextarea
                v-if="e.multiline"
                v-model="wording[e.key]"
                :rows="2"
                autoresize
                placeholder="Standard wording"
                class="w-full"
              />
              <UInput
                v-else
                v-model="wording[e.key]"
                placeholder="Standard wording"
                class="w-full"
              />
            </UFormField>
          </div>
        </div>
      </UCard>

      <PtSaveBar
        :dirty="wordingDirty"
        :saving="savingWording"
        label="Save wording"
        @save="saveWording"
        @discard="resetWording"
      />
    </template>

    <template v-else-if="tab === 'status'">
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">
              Status
            </h2>
            <UBadge
              :label="PT_LABELS.siteStatus[site.site.status]"
              :color="ptStatusColor(site.site.status)"
              variant="subtle"
            />
          </div>
        </template>
        <div class="space-y-3">
          <p
            v-if="site.site.status === 'draft'"
            class="text-sm text-muted"
          >
            Only people with the preview link can see a draft. Publish when you're ready for people to sign up.
          </p>
          <p
            v-else-if="site.site.status === 'published'"
            class="text-sm text-muted"
          >
            The site is live at <span class="font-mono">{{ site.url }}</span>. Archive it when it's over for good: the
            site then shows a short “this campaign has ended” page, with no signup and no reminders.
          </p>
          <p
            v-else
            class="text-sm text-muted"
          >
            Archived{{ site.site.archived_at ? ` on ${ptFormatDate(site.site.archived_at)}` : '' }}. Visitors see a short
            “this campaign has ended” page; no signup and no reminders. Un-archive it to open signup again.
          </p>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-if="site.site.status === 'draft'"
              label="Publish"
              icon="i-lucide-rocket"
              :loading="statusBusy"
              @click="setStatus('publish')"
            />
            <UButton
              v-if="site.site.status === 'published'"
              label="Archive"
              color="neutral"
              variant="outline"
              icon="i-lucide-archive"
              @click="archiveOpen = true"
            />
            <UButton
              v-if="site.site.status === 'archived'"
              label="Un-archive"
              icon="i-lucide-archive-restore"
              :loading="statusBusy"
              @click="setStatus('unarchive')"
            />
            <UButton
              label="Get a preview link"
              color="neutral"
              variant="outline"
              icon="i-lucide-eye"
              @click="preview"
            />
          </div>
          <div
            v-if="previewUrl"
            class="flex items-center gap-2"
          >
            <UInput
              :model-value="previewUrl"
              readonly
              class="flex-1 font-mono"
            />
            <UButton
              icon="i-lucide-copy"
              aria-label="Copy preview link"
              @click="copy(previewUrl)"
            />
          </div>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">
              Prayer.Tools directory
            </h2>
            <UBadge
              :label="site.directory ? (PT_LABELS.directoryStatus[site.directory.status] ?? site.directory.status) : 'Not listed'"
              :color="site.directory ? ptStatusColor(site.directory.status) : 'neutral'"
              variant="subtle"
            />
          </div>
        </template>
        <div class="space-y-3">
          <p class="text-sm text-muted">
            {{ DIRECTORY_TEXT[site.directory?.status ?? 'none'] ?? DIRECTORY_TEXT.none }}
            Your site stays reachable by its link either way.
          </p>
          <p
            v-if="(!site.directory || site.directory.status === 'unlisted') && site.site.status !== 'published'"
            class="text-xs text-muted"
          >
            Publish the site before asking to be listed.
          </p>
          <div class="flex gap-2">
            <UButton
              v-if="!site.directory || site.directory.status === 'unlisted'"
              icon="i-lucide-list-plus"
              :label="site.directory ? 'Ask to be listed again' : 'Ask to be listed'"
              :loading="directoryBusy"
              :disabled="site.site.status !== 'published'"
              @click="directory(true)"
            />
            <UButton
              v-if="site.directory"
              color="neutral"
              variant="outline"
              :label="site.directory.status === 'requested' ? 'Withdraw request' : 'Remove from the directory'"
              :loading="directoryBusy"
              @click="directory(false)"
            />
          </div>
        </div>
      </UCard>

      <UCard v-if="exportsLog?.exports.length">
        <template #header>
          <h2 class="font-semibold">
            Intercessor exports
          </h2>
          <p class="text-sm text-muted">
            Every download of intercessors' details.
          </p>
        </template>
        <ul class="text-sm divide-y divide-default">
          <li
            v-for="e in exportsLog.exports"
            :key="e.id"
            class="flex items-center gap-2 py-2 first:pt-0 last:pb-0"
          >
            <UIcon
              name="i-lucide-download"
              class="text-muted shrink-0"
            />
            <span class="flex-1 min-w-0">
              {{ e.display_name }} <span class="text-muted">({{ e.email }})</span>
            </span>
            <span class="text-muted whitespace-nowrap">
              {{ e.row_count }} rows · {{ ptFormatDate(e.created_at, { dateStyle: 'medium', timeStyle: 'short' }) }}
            </span>
          </li>
        </ul>
      </UCard>

      <UCard
        v-if="isOwner"
        :ui="{ root: 'ring-error/40' }"
      >
        <template #header>
          <h2 class="font-semibold text-error">
            Delete site
          </h2>
        </template>
        <div class="space-y-3">
          <p class="text-sm text-muted">
            Deletes the site, its campaigns, intercessors and stats for good. This can't be undone.
          </p>
          <UButton
            color="error"
            variant="outline"
            icon="i-lucide-trash-2"
            label="Delete site"
            @click="deleteOpen = true"
          />
        </div>
      </UCard>
    </template>

    <PtImagePicker
      :open="!!imagePicker"
      :language="site.site.default_language"
      :hero-for="imagePicker === 'image' ? site.site.template_key : undefined"
      @update:open="(v) => { if (!v) imagePicker = null }"
      @hero="(url) => {
        Object.assign(branding, { image_url: url, image_alt: undefined, image_credit: undefined, focal_x: undefined, focal_y: undefined })
        imagePicker = null
      }"
      @select="(a) => {
        branding[`${imagePicker}_url`] = a.url
        if (imagePicker === 'image') { branding.image_alt = a.asset.alt ?? undefined; branding.image_credit = a.credit ?? undefined; branding.focal_x = a.asset.focal_x; branding.focal_y = a.asset.focal_y }
        imagePicker = null
      }"
    />

    <UModal
      v-model:open="archiveOpen"
      title="Archive this site?"
      description="The site will show a short “this campaign has ended” page. Signup closes and reminders stop. You can un-archive it later."
    >
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="archiveOpen = false"
          />
          <UButton
            label="Archive"
            color="warning"
            icon="i-lucide-archive"
            :loading="statusBusy"
            @click="setStatus('archive')"
          />
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="deleteOpen"
      title="Delete this site?"
      :description="`This permanently deletes ${site.org.name}, including everyone who signed up and all stats.`"
    >
      <template #body>
        <UFormField :label="`Type ${site.org.slug} to confirm`">
          <UInput
            v-model="deleteConfirm"
            class="w-full"
            autocomplete="off"
          />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="deleteOpen = false"
          />
          <UButton
            label="Delete forever"
            color="error"
            icon="i-lucide-trash-2"
            :disabled="deleteConfirm !== site.org.slug"
            @click="deleteSite"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
