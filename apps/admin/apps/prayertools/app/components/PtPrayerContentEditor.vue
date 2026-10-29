<script setup lang="ts">
// Prayer content for a campaign, edited day by day: pick a day (with the date
// it falls on) and a language, then write what each section shows that day.
// A section is a site library: a ready-made prayer guide the site follows
// (the first edit gives the site its own copy), or content written for the site.
import { campaignLength } from '@prayertools/shared/setup'
import { entryDate, entryNumber } from '@prayertools/shared/schedule'
import { addDays, todayIn } from '@prayertools/shared/dates'
import { tiptapToHtml } from '@prayertools/shared/tiptap'
import { placeholderVars } from '@prayertools/shared/content'

const props = defineProps<{ embedded?: boolean, initialCampaignId?: string }>()

interface Lib {
  siteLibraryId: string
  title: string
  cadence: string
  libraryId: string | null
  follows: boolean
  frozenVersion: number | null
  latestVersion: number | null
  updateAvailable: boolean
  credit: string | null
  license: string | null
  entryCount: number
  coverage: Record<string, number>
  entryDays: Record<string, number[]>
  staleDays: Record<string, number[]>
  missingLanguages: string[]
  staleCount: number
}

interface Campaign {
  id: string
  name: string
  status: string
  cadence: 'daily' | 'weekly'
  timezone: string
  start_mode: 'date' | 'join'
  start_date: string | null
  end_mode: 'date' | 'none' | 'days'
  end_date: string | null
  length_days: number | null
}

interface Entry { source: string, doc: Record<string, any> | null, stale: boolean, edited: boolean, languages: string[] }

const { data: site, can } = usePtSite()
const { data: meta } = usePtMeta()
const toast = usePtToast()
const route = useRoute()

const { data: campaigns } = useFetch<{ campaigns: Campaign[] }>('/api/pt/campaigns', { key: 'pt-campaigns' })
const campaignId = ref<string | undefined>(props.initialCampaignId ?? (typeof route.query.campaign === 'string' ? route.query.campaign : undefined))
watch([campaigns, site], () => {
  if (!campaignId.value) campaignId.value = site.value?.currentCampaign?.id ?? campaigns.value?.campaigns[0]?.id
}, { immediate: true })
const campaign = computed(() => campaigns.value?.campaigns.find(c => c.id === campaignId.value))

const { data: content, refresh } = useFetch<{ libraries: Lib[], languages: string[], defaultLanguage: string }>('/api/pt/content', {
  query: computed(() => ({ campaign: campaignId.value })),
  key: computed(() => `pt-content-${campaignId.value}`),
  watch: [campaignId]
})
const libraries = computed(() => content.value?.libraries ?? [])

// ── Days and their dates ─────────────────────────────────────────────────
const weekly = computed(() => campaign.value?.cadence === 'weekly')
const unit = computed(() => weekly.value ? 'week' : 'day')
const Unit = computed(() => weekly.value ? 'Week' : 'Day')
const length = computed(() => campaign.value ? campaignLength(campaign.value) : null)
const lastEntry = computed(() => Math.max(0, ...libraries.value.map(l => l.entryCount)))
const anchor = computed(() => campaign.value?.start_mode === 'date' ? campaign.value.start_date : null)
const todayEntry = computed(() => {
  const c = campaign.value
  if (!c || !anchor.value || c.status !== 'active') return null
  return entryNumber(anchor.value, c.cadence, todayIn(c.timezone)) || null
})

const day = ref(1)
watch(campaignId, () => {
  editingId.value = null
  day.value = 1
})
watch(todayEntry, (n) => {
  if (n && day.value === 1 && (!length.value || n <= length.value)) day.value = n
}, { immediate: true })

const dayCount = computed(() => Math.max(length.value ?? 0, lastEntry.value, day.value, 1))
const days = computed(() => Array.from({ length: dayCount.value }, (_, i) => i + 1))
const canAddDay = computed(() => length.value === null && can('pt.content.write'))
const pastEnd = (n: number) => length.value !== null && n > length.value

function dateOf(n: number): string | null {
  return anchor.value && campaign.value ? entryDate(anchor.value, campaign.value.cadence, n) : null
}
function shortDate(n: number): string {
  const d = dateOf(n)
  if (!d) return ''
  if (weekly.value) return `${ptFormatDate(d, { day: 'numeric', month: 'short' })} – ${ptFormatDate(addDays(d, 6), { day: 'numeric', month: 'short' })}`
  return ptFormatDate(d, { weekday: 'short', day: 'numeric', month: 'short' })
}
function longDate(n: number): string {
  const d = dateOf(n)
  if (!d) return campaign.value?.start_mode === 'join' ? `The ${ordinal(n)} ${unit.value} after each person signs up` : ''
  if (weekly.value) return `${ptFormatDate(d, { weekday: 'long', day: 'numeric', month: 'long' })} – ${ptFormatDate(addDays(d, 6), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`
  return ptFormatDate(d, { dateStyle: 'full' })
}
function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${s}`
}

const summary = computed(() => {
  const c = campaign.value
  if (!c) return ''
  const per = weekly.value ? 'each week' : 'each day'
  if (c.start_mode === 'join') {
    return `Each person starts at ${unit.value} 1 when they sign up and moves to the next entry at most once a ${unit.value}, by opening the one they are on${length.value ? `, for ${length.value} ${unit.value}s` : c.end_mode === 'days' ? ', until the last entry' : ''}.`
  }
  const start = c.start_date ? ptFormatDate(c.start_date, { dateStyle: 'long' }) : ''
  if (length.value && c.end_date) return `Write what people pray ${per} of ${c.name}: ${length.value} ${unit.value}s, from ${start} to ${ptFormatDate(c.end_date, { dateStyle: 'long' })}.`
  return `Write what people pray ${per} of ${c.name}, starting ${start}, with no end date.`
})

// ── Language ─────────────────────────────────────────────────────────────
const lang = ref('en')
watch(site, (s) => {
  if (s) lang.value = s.site.default_language
}, { immediate: true })
const defaultLang = computed(() => site.value?.site.default_language ?? 'en')
const isSource = computed(() => lang.value === defaultLang.value)
const canEdit = computed(() => isSource.value ? can('pt.content.write') : can('pt.content.translate'))
const dir = computed(() => meta.value?.languages.find(l => l.code === lang.value)?.dir ?? 'ltr')
const langName = (code: string) => languageName(meta.value, code)
const vars = computed(() => {
  const date = (d: string | null) => d ? new Intl.DateTimeFormat(lang.value, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`)) : ''
  return placeholderVars({
    siteName: site.value?.org.name ?? '',
    campaignName: campaign.value?.name ?? '',
    lang: lang.value,
    place: site.value?.site.place_name,
    placeWording: site.value?.site.place_wording,
    peopleGroup: site.value?.site.people_group,
    startDate: date(campaign.value?.start_date ?? null),
    endDate: date(campaign.value?.end_date ?? null)
  })
})

// ── Day status in the chosen language ───────────────────────────────────
const filled = computed(() => libraries.value.map(l => new Set(l.entryDays[lang.value] ?? [])))
const stale = computed(() => new Set(libraries.value.flatMap(l => l.staleDays[lang.value] ?? [])))
type DayState = 'done' | 'partial' | 'empty' | 'stale'
function dayState(n: number): DayState {
  const have = filled.value.filter(s => s.has(n)).length
  if (!have) return 'empty'
  if (stale.value.has(n)) return 'stale'
  return have === filled.value.length ? 'done' : 'partial'
}
const STATE_UI: Record<DayState, { icon: string, class: string, label: string }> = {
  done: { icon: 'i-lucide-circle-check', class: 'text-(--ui-success)', label: 'Written' },
  partial: { icon: 'i-lucide-circle-dot', class: 'text-(--ui-warning)', label: 'Partly written' },
  stale: { icon: 'i-lucide-clock-alert', class: 'text-(--ui-warning)', label: 'Out of date' },
  empty: { icon: 'i-lucide-circle-dashed', class: 'text-(--ui-text-dimmed)', label: 'Not written yet' }
}
const doneCount = computed(() => days.value.filter(n => !pastEnd(n) && dayState(n) === 'done').length)

// ── Entries for the chosen day ──────────────────────────────────────────
const entries = ref<Record<string, Entry>>({})
const loadingEntries = ref(false)
let loadKey = ''
async function loadEntries() {
  const libs = libraries.value
  const key = `${campaignId.value}:${day.value}:${lang.value}`
  loadKey = key
  if (!libs.length) {
    entries.value = {}
    return
  }
  loadingEntries.value = true
  try {
    const res = await Promise.all(libs.map(l => $fetch<Entry>('/api/pt/content/entry', { query: { siteLibrary: l.siteLibraryId, day: day.value, lang: lang.value } })))
    if (loadKey === key) entries.value = Object.fromEntries(libs.map((l, i) => [l.siteLibraryId, res[i]!]))
  } finally {
    if (loadKey === key) loadingEntries.value = false
  }
}
watch([day, lang, () => libraries.value.map(l => l.siteLibraryId).join()], loadEntries, { immediate: true })

// ── Editing one section of the day ──────────────────────────────────────
const editingId = ref<string | null>(null)
const draft = ref<Record<string, any> | null>(null)
const original = ref('')
const html = (doc: Record<string, any> | null) => tiptapToHtml(doc as never, { mode: 'web' })
const dirty = computed(() => !!editingId.value && html(draft.value) !== original.value)

function startEdit(l: Lib, doc?: Record<string, any> | null) {
  const current = entries.value[l.siteLibraryId]?.doc ?? null
  editingId.value = l.siteLibraryId
  original.value = html(current)
  draft.value = JSON.parse(JSON.stringify(doc ?? current))
}
function stopEdit() {
  editingId.value = null
  draft.value = null
}

const pending = ref<{ day: number, lang: string } | null>(null)
const pendingOpen = computed({
  get: () => !!pending.value,
  set: (v: boolean) => {
    if (!v) pending.value = null
  }
})
function go(to: { day?: number, lang?: string }) {
  const next = { day: to.day ?? day.value, lang: to.lang ?? lang.value }
  if (next.day === day.value && next.lang === lang.value) return
  if (dirty.value) {
    pending.value = next
    return
  }
  applyNav(next)
}
function applyNav(next: { day: number, lang: string }) {
  pending.value = null
  stopEdit()
  day.value = next.day
  lang.value = next.lang
}

const saving = ref(false)
async function save(l: Lib) {
  saving.value = true
  try {
    await $fetch('/api/pt/content/entry', { method: 'PUT', body: { siteLibraryId: l.siteLibraryId, day: day.value, lang: lang.value, doc: draft.value ?? { type: 'doc', content: [] } } })
    toast.ok(`Saved ${unit.value} ${day.value} in ${langName(lang.value)}`)
    stopEdit()
    await refresh()
    await loadEntries()
  } catch (err) {
    toast.fail(err)
  } finally {
    saving.value = false
  }
}

const translating = ref<string | null>(null)
async function aiTranslate(l: Lib) {
  translating.value = l.siteLibraryId
  try {
    const src = await $fetch<{ doc: Record<string, any> | null }>('/api/pt/content/entry', { query: { siteLibrary: l.siteLibraryId, day: day.value, lang: defaultLang.value } })
    if (!src.doc) throw new Error(`Write ${unit.value} ${day.value} in ${langName(defaultLang.value)} first.`)
    const res = await $fetch<{ doc: Record<string, any> }>('/api/pt/translate', { method: 'POST', body: { doc: src.doc, from: defaultLang.value, to: lang.value } })
    startEdit(l, res.doc)
    toast.ok('Translated', 'Review it, then save.')
  } catch (err) {
    toast.fail(err, 'Translation failed')
  } finally {
    translating.value = null
  }
}

async function markCurrent(l: Lib) {
  await $fetch('/api/pt/content/entry-status', { method: 'POST', body: { siteLibraryId: l.siteLibraryId, day: day.value, lang: lang.value } })
  await refresh()
  await loadEntries()
}

// ── Sections ────────────────────────────────────────────────────────────
const catalogOpen = ref(false)
async function addLibrary(libraryId: string) {
  try {
    await $fetch('/api/pt/content/libraries', { method: 'POST', body: { campaignId: campaignId.value, libraryId } })
    catalogOpen.value = false
    await refresh()
  } catch (err) {
    toast.fail(err)
  }
}
const defaultTitle = computed(() => weekly.value ? 'Prayer for the week' : 'Prayer for the day')
async function createOwn(title: string): Promise<string | null> {
  try {
    const res = await $fetch<{ siteLibraryId: string }>('/api/pt/content/libraries', { method: 'POST', body: { campaignId: campaignId.value, title, cadence: campaign.value?.cadence } })
    await refresh()
    return res.siteLibraryId
  } catch (err) {
    toast.fail(err)
    return null
  }
}
const ownTitle = ref('')
async function addOwn() {
  const id = await createOwn(ownTitle.value || defaultTitle.value)
  if (!id) return
  ownTitle.value = ''
  catalogOpen.value = false
}
async function startWriting() {
  const id = await createOwn(defaultTitle.value)
  if (!id) return
  applyNav({ day: 1, lang: defaultLang.value })
  editingId.value = id
  original.value = html(null)
  draft.value = null
}

const removing = ref<Lib | null>(null)
const removeOpen = computed({
  get: () => !!removing.value,
  set: (v: boolean) => {
    if (!v) removing.value = null
  }
})
async function removeLibrary(l: Lib) {
  removing.value = null
  if (editingId.value === l.siteLibraryId) stopEdit()
  await $fetch(`/api/pt/content/libraries/${l.siteLibraryId}`, { method: 'DELETE', query: { campaign: campaignId.value } })
  await refresh()
}
async function move(l: Lib, delta: number) {
  const ids = libraries.value.map(x => x.siteLibraryId)
  const i = ids.indexOf(l.siteLibraryId)
  const j = i + delta
  if (j < 0 || j >= ids.length) return
  ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
  await $fetch('/api/pt/content/order', { method: 'PUT', body: { campaignId: campaignId.value, ids } })
  await refresh()
}

const compare = reactive({ open: false, lib: null as Lib | null, site: null as Record<string, any> | null, library: null as Record<string, any> | null })
async function openCompare(l: Lib) {
  const res = await $fetch<{ site: Record<string, any> | null, library: Record<string, any> | null }>('/api/pt/content/compare', { query: { siteLibrary: l.siteLibraryId, day: day.value, lang: lang.value } })
  Object.assign(compare, { open: true, lib: l, site: res.site, library: res.library })
}
async function takeUpdate() {
  if (!compare.lib) return
  await $fetch('/api/pt/content/take-update', { method: 'POST', body: { siteLibraryId: compare.lib.siteLibraryId } })
  compare.open = false
  toast.ok('Updated to the latest version', 'Your edits to this prayer guide were replaced.')
  await refresh()
  await loadEntries()
}

function sourceBadge(l: Lib): { label: string, color: 'info' | 'warning' | 'neutral', icon: string } {
  if (l.follows) return { label: 'Ready-made guide', color: 'info', icon: 'i-lucide-book-open' }
  if (l.libraryId) return { label: `Your edited copy of a guide (v${l.frozenVersion})`, color: 'warning', icon: 'i-lucide-git-branch' }
  return { label: 'Written by your team', color: 'neutral', icon: 'i-lucide-pencil-line' }
}
defineExpose({ dirty, saving })
</script>

<template>
  <div class="prayer-content-editor max-w-6xl mx-auto space-y-6">
    <PtCampaignTabs
      v-if="!props.embedded && typeof route.query.campaign === 'string'"
      :campaign-id="route.query.campaign"
    />
    <PtContentTabs v-else-if="!props.embedded" />
    <div class="flex flex-wrap items-start justify-between gap-4" :class="!props.embedded ? 'rounded-lg bg-[#202833] p-6 sm:p-8 text-white' : ''">
      <div>
        <p v-if="!props.embedded" class="mb-3 text-xs font-semibold uppercase tracking-widest text-orange-300">Your campaign’s prayer guide</p>
        <h1 v-if="!props.embedded" class="text-2xl font-semibold">
          Prayer content
        </h1>
        <p
          v-if="summary"
          class="mt-1 max-w-2xl text-sm text-(--ui-text-muted)"
          :class="!props.embedded ? 'content-intro' : ''"
        >
          {{ summary }}
        </p>
      </div>
      <USelect
        v-if="!props.embedded && (campaigns?.campaigns.length ?? 0) > 1"
        v-model="campaignId"
        :items="campaigns!.campaigns.map(c => ({ label: c.name, value: c.id }))"
        class="w-64"
        aria-label="Campaign"
      />
    </div>

    <UEmpty
      v-if="campaigns && !campaigns.campaigns.length"
      icon="i-lucide-calendar-plus"
      title="No campaign yet"
      description="Create a campaign first. Its dates decide how many days of prayers to write."
      :actions="[{ label: 'New campaign', icon: 'i-lucide-plus', to: '/site/campaigns/new' }]"
    />

    <template v-else-if="content && !libraries.length">
      <div
        v-if="can('pt.content.write')"
        class="grid md:grid-cols-2 gap-4"
      >
        <UCard :ui="{ body: 'space-y-3' }">
          <UIcon
            name="i-lucide-pencil-line"
            class="size-8 text-(--ui-primary)"
          />
          <h2 class="text-lg font-semibold">
            Write your own prayers
          </h2>
          <p class="text-sm text-(--ui-text-muted)">
            Write a prayer for each {{ unit }}<template v-if="length">
              of the {{ length }} {{ unit }}s
            </template> of {{ campaign?.name }}, starting with {{ unit }} 1. You can translate it into your other languages afterwards.
          </p>
          <UButton
            icon="i-lucide-pencil"
            :label="`Start writing ${unit} 1`"
            @click="startWriting"
          />
        </UCard>
        <UCard :ui="{ body: 'space-y-3' }">
          <UIcon
            name="i-lucide-book-open"
            class="size-8 text-(--ui-primary)"
          />
          <h2 class="text-lg font-semibold">
            Use a ready-made prayer guide
          </h2>
          <p class="text-sm text-(--ui-text-muted)">
            Choose a guide someone has already written, with one prayer for every {{ unit }} (for example a 30-day Ramadan guide). You can still change any {{ unit }}.
          </p>
          <UButton
            variant="soft"
            icon="i-lucide-library"
            label="Browse prayer guides"
            @click="catalogOpen = true"
          />
        </UCard>
      </div>
      <UEmpty
        v-else
        icon="i-lucide-book-open"
        title="No prayer content yet"
        description="An editor on your team chooses or writes the content for this campaign."
      />
    </template>

    <div
      v-else-if="content && campaign"
      class="grid lg:grid-cols-[17rem_1fr] gap-6 items-start"
    >
      <UCard
        class="lg:sticky lg:top-4"
        :ui="{ header: 'p-3 sm:px-4', body: 'p-1 sm:p-1', footer: 'p-3 sm:px-4' }"
      >
        <template #header>
          <h2 class="font-semibold">
            {{ Unit }}s of the campaign
          </h2>
          <p class="text-xs text-(--ui-text-muted)">
            {{ length ? `${doneCount} of ${length}` : doneCount }} written in {{ langName(lang) }}
          </p>
        </template>
        <nav
          :aria-label="`${Unit}s`"
          class="max-h-80 lg:max-h-[calc(100vh-16rem)] overflow-y-auto"
        >
          <template
            v-for="n in days"
            :key="n"
          >
            <p
              v-if="length && n === length + 1"
              class="mt-2 border-t border-(--ui-border) px-3 pt-3 pb-1 text-xs text-(--ui-text-muted)"
            >
              After the campaign ends. These {{ unit }}s aren't shown on your site.
            </p>
            <button
              type="button"
              class="w-full flex items-center gap-2 rounded-xl px-3 py-3 text-start text-sm transition-colors cursor-pointer"
              :class="[n === day ? 'bg-[#fff0e3] text-[#a94300] font-semibold ring-1 ring-inset ring-[#f58220]/40' : 'hover:bg-(--ui-bg-elevated)', pastEnd(n) && n !== day ? 'opacity-60' : '']"
              :aria-current="n === day ? 'true' : undefined"
              :title="STATE_UI[dayState(n)].label"
              @click="go({ day: n })"
            >
              <UIcon
                :name="STATE_UI[dayState(n)].icon"
                class="size-4 shrink-0"
                :class="STATE_UI[dayState(n)].class"
              />
              <span class="tabular-nums">{{ Unit }} {{ n }}</span>
              <UBadge
                v-if="n === todayEntry"
                label="Today"
                size="sm"
                variant="subtle"
              />
              <span class="ms-auto text-xs whitespace-nowrap text-(--ui-text-muted)">{{ shortDate(n) }}</span>
            </button>
          </template>
          <button
            v-if="canAddDay"
            type="button"
            class="w-full flex items-center gap-2 rounded-md px-3 py-1.5 text-start text-sm text-(--ui-primary) hover:bg-(--ui-bg-elevated)"
            @click="go({ day: dayCount + 1 })"
          >
            <UIcon
              name="i-lucide-plus"
              class="size-4"
            />
            Add {{ unit }} {{ dayCount + 1 }}
          </button>
        </nav>
        <template #footer>
          <ul class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-(--ui-text-muted)">
            <li
              v-for="(s, key) in STATE_UI"
              :key="key"
              class="flex items-center gap-1.5"
            >
              <UIcon
                :name="s.icon"
                class="size-3.5 shrink-0"
                :class="s.class"
              />
              {{ s.label }}
            </li>
          </ul>
        </template>
      </UCard>

      <div class="space-y-4 min-w-0">
        <UCard :ui="{ body: 'space-y-4' }">
          <div class="flex items-center gap-2 sm:gap-4">
            <UButton
              icon="i-lucide-chevron-left"
              color="neutral"
              variant="outline"
              :label="day > 1 ? `${Unit} ${day - 1}` : undefined"
              :aria-label="`Previous ${unit}`"
              :disabled="day <= 1"
              @click="go({ day: day - 1 })"
            />
            <div class="flex-1 min-w-0 text-center">
              <p class="text-xs font-medium uppercase tracking-wide text-(--ui-text-muted) truncate">
                {{ campaign.name }}
              </p>
              <h2 class="text-2xl font-semibold tabular-nums">
                {{ Unit }} {{ day }}<span
                  v-if="length"
                  class="text-base font-normal text-(--ui-text-muted)"
                > of {{ length }}</span>
              </h2>
              <p class="text-sm">
                {{ longDate(day) }}
              </p>
              <div class="mt-1 flex justify-center gap-1">
                <UBadge
                  v-if="day === todayEntry"
                  label="Today"
                  size="sm"
                  variant="subtle"
                />
                <UBadge
                  v-if="pastEnd(day)"
                  :label="`After the campaign ends — this ${unit} isn't shown`"
                  size="sm"
                  color="warning"
                  variant="subtle"
                />
              </div>
            </div>
            <UButton
              trailing-icon="i-lucide-chevron-right"
              color="neutral"
              variant="outline"
              :label="day < dayCount || canAddDay ? `${Unit} ${day + 1}` : undefined"
              :aria-label="`Next ${unit}`"
              :disabled="day >= dayCount && !canAddDay"
              @click="go({ day: day + 1 })"
            />
          </div>
          <div
            v-if="(site?.site.languages.length ?? 0) > 1"
            class="flex flex-wrap items-center justify-center gap-2 border-t border-(--ui-border) pt-4"
            role="group"
            aria-label="Language"
          >
            <span class="text-sm text-(--ui-text-muted)">Writing in</span>
            <UButton
              v-for="code in site?.site.languages ?? []"
              :key="code"
              size="sm"
              :color="code === lang ? 'primary' : 'neutral'"
              :variant="code === lang ? 'solid' : 'outline'"
              :label="langName(code) + (code === defaultLang ? ' (default)' : '')"
              :aria-pressed="code === lang"
              @click="go({ lang: code })"
            />
          </div>
          <p
            v-else
            class="text-center text-sm text-(--ui-text-muted) border-t border-(--ui-border) pt-4"
          >
            Writing in {{ langName(lang) }}
          </p>
        </UCard>

        <UCard
          v-for="(l, i) in libraries"
          :key="l.siteLibraryId"
          :ui="{ body: 'space-y-4' }"
        >
          <template #header>
            <div class="flex flex-wrap items-center gap-2">
              <div class="min-w-0">
                <p
                  v-if="libraries.length > 1"
                  class="text-xs text-(--ui-text-muted)"
                >
                  Section {{ i + 1 }} of {{ libraries.length }}
                </p>
                <h3 class="text-lg font-semibold">
                  {{ l.title }}
                </h3>
              </div>
              <UBadge
                size="sm"
                variant="subtle"
                v-bind="sourceBadge(l)"
              />
              <div
                v-if="canEdit && editingId !== l.siteLibraryId"
                class="ms-auto flex gap-2"
              >
                <UButton
                  v-if="!isSource"
                  size="sm"
                  variant="soft"
                  icon="i-lucide-languages"
                  label="AI translate"
                  :loading="translating === l.siteLibraryId"
                  @click="aiTranslate(l)"
                />
                <UButton
                  v-if="entries[l.siteLibraryId]?.doc"
                  size="sm"
                  icon="i-lucide-pencil"
                  label="Edit prayer entry"
                  @click="startEdit(l)"
                />
              </div>
            </div>
          </template>

          <p
            v-if="loadingEntries && !entries[l.siteLibraryId]"
            class="text-sm text-(--ui-text-muted)"
          >
            Loading…
          </p>
          <template v-else>
            <UAlert
              v-if="l.updateAvailable"
              color="info"
              variant="subtle"
              icon="i-lucide-sparkle"
              :title="`A newer version of this prayer guide is available (version ${l.latestVersion}).`"
              :actions="[{ label: 'Compare', variant: 'soft', onClick: () => openCompare(l) }]"
            />
            <UAlert
              v-if="entries[l.siteLibraryId]?.stale"
              color="warning"
              variant="subtle"
              icon="i-lucide-triangle-alert"
              title="Out of date"
              :description="`${langName(defaultLang)} was changed after this translation was written.`"
              :actions="canEdit ? [{ label: 'Keep as is', variant: 'soft', onClick: () => markCurrent(l) }] : []"
            />
            <template v-if="editingId === l.siteLibraryId">
              <UAlert
                v-if="l.follows"
                color="info"
                variant="subtle"
                icon="i-lucide-git-branch"
                title="Saving gives your site its own copy of this prayer guide."
                description="After that, updates to the guide don't reach your site unless you choose to take them."
              />
              <PtRichEditor
                v-model="draft"
                placeholders
                :dir="dir"
                min-height="20rem"
                :placeholder="`Write the prayer for ${unit} ${day} in ${langName(lang)}…`"
              />
              <p class="text-xs text-(--ui-text-muted)">
                Placeholders like {place} are filled in on the site.
              </p>
              <div class="flex justify-end gap-2">
                <UButton
                  label="Cancel"
                  color="neutral"
                  variant="ghost"
                  @click="stopEdit"
                />
                <UButton
                  :label="`Save ${unit} ${day} · ${langName(lang)}`"
                  icon="i-lucide-check"
                  :loading="saving"
                  @click="save(l)"
                />
              </div>
            </template>
            <PtContentView
              v-else-if="entries[l.siteLibraryId]?.doc"
              :doc="entries[l.siteLibraryId]!.doc"
              :vars="vars"
              :dir="dir"
            />
            <div
              v-else
              class="rounded-lg border border-dashed border-(--ui-border-accented) p-6 text-center space-y-3"
            >
              <p class="text-sm text-(--ui-text-muted)">
                Nothing written for {{ unit }} {{ day }} in {{ langName(lang) }} yet.
              </p>
              <UButton
                v-if="canEdit"
                icon="i-lucide-pencil"
                :label="`Write ${unit} ${day} in ${langName(lang)}`"
                @click="startEdit(l)"
              />
            </div>
          </template>
        </UCard>

        <UCard v-if="can('pt.content.write')">
          <template #header>
            <h2 class="font-semibold">
              Sections shown every {{ unit }}
            </h2>
            <p class="text-sm text-(--ui-text-muted)">
              Most campaigns need one. Add more to combine, say, a daily focus with a scripture reading; they appear in this order.
            </p>
          </template>
          <ul class="divide-y divide-(--ui-border)">
            <li
              v-for="(l, i) in libraries"
              :key="l.siteLibraryId"
              class="flex flex-wrap items-center gap-2 py-2 first:pt-0 last:pb-0"
            >
              <div class="min-w-0">
                <p class="text-sm font-medium">
                  {{ l.title }}
                </p>
                <p class="text-xs text-(--ui-text-muted)">
                  {{ sourceBadge(l).label }} · {{ ptPlural(l.entryCount, unit, `${unit}s`) }}<template v-if="l.credit">
                    · {{ l.credit }}
                  </template><template v-if="l.missingLanguages.length">
                    · not complete in {{ l.missingLanguages.map(langName).join(', ') }}
                  </template>
                </p>
              </div>
              <div class="ms-auto flex shrink-0">
                <UButton
                  icon="i-lucide-arrow-up"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  aria-label="Show earlier"
                  :disabled="i === 0"
                  @click="move(l, -1)"
                />
                <UButton
                  icon="i-lucide-arrow-down"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  aria-label="Show later"
                  :disabled="i === libraries.length - 1"
                  @click="move(l, 1)"
                />
                <UButton
                  icon="i-lucide-trash-2"
                  size="xs"
                  variant="ghost"
                  color="error"
                  aria-label="Remove from campaign"
                  @click="removing = l"
                />
              </div>
            </li>
          </ul>
          <template #footer>
            <UButton
              variant="soft"
              icon="i-lucide-plus"
              label="Add a section"
              @click="catalogOpen = true"
            />
          </template>
        </UCard>
      </div>
    </div>

    <USlideover
      v-model:open="catalogOpen"
      title="Add prayer content"
      description="A prayer guide (also called a library) is a ready-made set of prayers, one for each day or week. Your site follows it, so fixes and new translations arrive automatically until you change a day."
      :ui="{ content: 'sm:max-w-3xl' }"
    >
      <template #body>
        <div class="space-y-5">
          <PtLibraryCatalog
            :template="site?.site.template_key"
            :cadence="campaign?.cadence"
            :site-languages="site?.site.languages ?? []"
            :used-ids="libraries.map(l => l.libraryId).filter(Boolean) as string[]"
            @use="addLibrary"
          />
          <UCard>
            <div class="flex flex-wrap items-end justify-between gap-3">
              <div class="min-w-0 flex-1 space-y-2">
                <div>
                  <p class="font-medium">
                    Write your own
                  </p>
                  <p class="text-sm text-(--ui-text-muted)">
                    Start with a blank page for every {{ unit }} of this campaign.
                  </p>
                </div>
                <UInput
                  v-model="ownTitle"
                  :placeholder="defaultTitle"
                  aria-label="Section name"
                  class="w-full max-w-sm"
                />
              </div>
              <UButton
                variant="soft"
                icon="i-lucide-pencil-line"
                label="Start from scratch"
                @click="addOwn"
              />
            </div>
          </UCard>
        </div>
      </template>
    </USlideover>

    <UModal
      v-model:open="pendingOpen"
      title="Discard your changes?"
      :description="`Your changes to ${unit} ${day} in ${langName(lang)} aren't saved.`"
    >
      <template #footer>
        <div class="flex gap-2">
          <UButton
            color="error"
            label="Discard changes"
            @click="pending && applyNav(pending)"
          />
          <UButton
            variant="ghost"
            color="neutral"
            label="Keep editing"
            @click="pending = null"
          />
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="removeOpen"
      :title="`Remove ${removing?.title}?`"
      :description="removing?.follows ? 'The prayer guide stays in the catalog; you can add it again later.' : 'It is removed from this campaign.'"
    >
      <template #footer>
        <div class="flex gap-2">
          <UButton
            color="error"
            icon="i-lucide-trash-2"
            label="Remove"
            @click="removing && removeLibrary(removing)"
          />
          <UButton
            variant="ghost"
            color="neutral"
            label="Cancel"
            @click="removing = null"
          />
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="compare.open"
      :title="`${Unit} ${day}: your copy and the latest version`"
      :ui="{ content: 'max-w-5xl' }"
    >
      <template #body>
        <div class="grid md:grid-cols-2 gap-4">
          <div class="rounded-lg border border-(--ui-border) p-4">
            <h3 class="text-sm font-semibold text-(--ui-text-muted) mb-2">
              Your copy
            </h3>
            <PtContentView :doc="compare.site" />
          </div>
          <div class="rounded-lg border border-(--ui-primary)/40 p-4">
            <h3 class="text-sm font-semibold text-(--ui-primary) mb-2">
              Latest version of the guide
            </h3>
            <PtContentView :doc="compare.library" />
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex items-center justify-between gap-3 w-full">
          <p class="text-xs text-(--ui-text-muted) flex items-center gap-1.5">
            <UIcon
              name="i-lucide-triangle-alert"
              class="size-4 shrink-0 text-(--ui-warning)"
            />
            Taking the update replaces every edit you made to this prayer guide.
          </p>
          <UButton
            v-if="can('pt.content.write')"
            label="Take the update"
            icon="i-lucide-download"
            color="warning"
            @click="takeUpdate"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
.content-intro { color: #cbd5e1; line-height: 1.65; margin-top: 0.75rem; }
</style>
