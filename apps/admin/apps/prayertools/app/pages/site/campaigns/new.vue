<script setup lang="ts">
// New campaign, or a relaunch: a new campaign on the same site that starts
// from the previous one's answers and content. A main campaign shows at the
// site's address, one at a time; a side campaign runs beside it on fixed
// dates at its own address. Its place and people group start as the current
// campaign's (or, for a relaunch, the previous one's).
import { applyTemplate, offeredTemplates, overlappingCampaign, suggestedStartDate } from '@prayertools/shared/setup'
import { addDays, todayIn } from '@prayertools/shared/dates'
import type { SetupDraft } from '../../../components/PtSetupForm.vue'
import type { PtLocation } from '../../../components/PtLocationSearch.vue'
import type { PtCampaign } from '../../../utils/pt-campaign-ui'

definePageMeta({ middleware: 'auth' })

const route = useRoute()
const relaunchOf = computed(() => (typeof route.query.relaunch === 'string' ? route.query.relaunch : null))
const { data: site } = usePtSite()
const { data: meta } = usePtMeta()
const toast = usePtToast()
const { data: previous } = useFetch<{ campaign: PtCampaign }>(() => `/api/pt/campaigns/${relaunchOf.value}`, { immediate: !!relaunchOf.value, key: `pt-relaunch-${relaunchOf.value}` })

const templateKey = ref('generic')
const kind = ref<'side' | null>(route.query.kind === 'side' ? 'side' : null)
const name = ref('')
const suggestedName = ref('')
const setup = ref<SetupDraft>({ start_mode: 'date', start_date: null, end_mode: 'date', end_date: null, length_days: null, goal: null, cadence: 'daily', track_time: false, goal_target: null, slot_min: null })
const location = ref<PtLocation | null>(null)
const peopleGroup = ref('')
function placeFrom(c: { place_name: string | null, latitude: number | null, longitude: number | null, people_group: string | null } | null | undefined) {
  location.value = c?.place_name ? { name: c.place_name, latitude: c.latitude, longitude: c.longitude } : null
  peopleGroup.value = c?.people_group ?? ''
}
watch(previous, (p) => {
  const c = p?.campaign
  if (!c) return
  templateKey.value = c.template_key ?? 'generic'
  kind.value = c.kind
  name.value = c.name.replace(/\d{4}/, (y: string) => String(Number(y) + 1))
  setup.value = { start_mode: c.start_mode, start_date: null, end_mode: c.end_mode, end_date: null, length_days: c.length_days, goal: c.goal, cadence: c.cadence, track_time: c.track_time, goal_target: c.goal_target, slot_min: c.slot_min ?? null }
  placeFrom(c)
}, { immediate: true })

const templateLength = () => meta.value?.templates.find(t => t.key === templateKey.value)?.setup.length_days as number | undefined

function chooseTemplate(key: string) {
  templateKey.value = key
  const t = meta.value?.templates.find(x => x.key === key)
  if (!t) return
  setup.value = { ...setup.value, ...(t.setup as Partial<SetupDraft>) }
  if (t.setup.length_days && setup.value.start_mode === 'date') setup.value.length_days = null
  const start = setup.value.start_mode === 'date' ? suggestedStartDate(key, todayIn(site.value?.site.timezone ?? 'UTC')) : null
  if (start) setup.value.start_date = start
  // A name the template suggested follows the template; a name the user typed stays.
  if (!name.value.trim() || name.value === suggestedName.value) {
    suggestedName.value = key === 'ramadan' && start ? `Ramadan ${start.slice(0, 4)}` : ''
    name.value = suggestedName.value
  }
  fillEndDate()
}

// Templates with a fixed length end their dated campaigns that many days after the start.
function fillEndDate() {
  const days = templateLength()
  if (relaunchOf.value || templateKey.value === 'generic' || !days || setup.value.start_mode !== 'date' || !setup.value.start_date) return
  setup.value.end_date = addDays(setup.value.start_date, days - 1)
}
watch(() => setup.value.start_date, fillEndDate)

// A site runs one main campaign at a time: the dates other main campaigns hold, and the one these dates would overlap.
const { data: existing } = useFetch<{ campaigns: PtCampaign[] }>('/api/pt/campaigns', { key: 'pt-campaigns' })
const booked = computed(() => kind.value === 'side' ? [] : (existing.value?.campaigns ?? []).filter(c => c.status !== 'ended' && c.kind !== 'side'))
const clash = computed(() => {
  const answers = applyTemplate(templateKey.value, { ...setup.value, goal: setup.value.goal ?? undefined, end_date: setup.value.end_date ?? undefined })
  const mine = { ...answers, timezone: site.value?.site.timezone ?? 'UTC' }
  return overlappingCampaign(mine, kind.value, existing.value?.campaigns ?? [])
})
// While a main campaign is running or upcoming, a new campaign starts as a
// side campaign from scratch; otherwise as a main campaign on the current
// campaign's template, when that template is on offer.
const prefilled = ref(false)
watch([site, meta, existing], ([s, m, e]) => {
  if (prefilled.value || relaunchOf.value || !s || !m || !e) return
  prefilled.value = true
  if (!route.query.kind && e.campaigns.some(c => c.kind !== 'side' && c.status !== 'ended')) kind.value = 'side'
  const current = s.currentCampaign?.template_key as string | undefined
  const template = current && offeredTemplates(todayIn(s.site.timezone)).includes(current) ? current : 'generic'
  chooseTemplate(kind.value === 'side' ? 'generic' : template)
  placeFrom(s.currentCampaign as PtCampaign | null)
}, { immediate: true })
const kindItems = [
  { value: 'main', label: 'Main campaign', description: 'Shows at your site\'s address. A site runs one main campaign at a time.' },
  { value: 'side', label: 'Side campaign', description: 'Runs alongside your main campaign at its own address, with its own landing page and dates. Your home page links to it while it runs.' }
]
const kindValue = computed({
  get: () => kind.value ?? 'main',
  set: (v: string) => { kind.value = v === 'side' ? 'side' : null }
})

const saving = ref(false)
async function create() {
  saving.value = true
  try {
    const body: Record<string, unknown> = {
      ...setup.value,
      name: name.value,
      template_key: templateKey.value,
      kind: kind.value,
      place_name: location.value?.name ?? null,
      latitude: location.value?.latitude ?? null,
      longitude: location.value?.longitude ?? null,
      people_group: peopleGroup.value || null
    }
    if (relaunchOf.value) body.relaunchOf = relaunchOf.value
    if (!setup.value.end_date) delete body.end_date
    const res = await $fetch<{ campaign: { id: string, published_at: string | null } }>('/api/pt/campaigns', { method: 'POST', body })
    await refreshNuxtData('pt-campaigns')
    // A draft continues in the campaign's setup steps.
    await navigateTo(res.campaign.published_at ? `/site/campaigns/${res.campaign.id}` : `/site/campaigns/setup/${res.campaign.id}`)
  } catch (err) {
    toast.fail(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6">
    <header>
      <UButton
        to="/site/campaigns"
        icon="i-lucide-arrow-left"
        variant="link"
        color="neutral"
        label="Campaigns"
        class="px-0"
      />
      <h1 class="text-2xl font-bold">
        {{ relaunchOf ? `Relaunch ${previous?.campaign?.name ?? ''}` : 'New campaign' }}
      </h1>
      <p class="text-sm text-muted">
        A site runs one main campaign at a time, so main campaign dates can't overlap. A side campaign can run alongside it.
      </p>
    </header>

    <UAlert
      v-if="booked.length"
      icon="i-lucide-calendar-range"
      variant="subtle"
      color="neutral"
      title="Dates already taken"
    >
      <template #description>
        <ul class="space-y-0.5">
          <li
            v-for="c in booked"
            :key="c.id"
          >
            {{ c.name }}: {{ ptCampaignDates(c) }}
          </li>
        </ul>
      </template>
    </UAlert>

    <UAlert
      v-if="relaunchOf"
      icon="i-lucide-rotate-ccw"
      variant="subtle"
      color="info"
      title="Starts from the previous campaign"
      description="The new campaign reuses the same prayer content. Libraries you follow pick up their latest version; content you edited carries over. You can invite people from the past campaign with a site email."
    />

    <UCard>
      <div class="space-y-8">
        <UFormField
          v-if="!relaunchOf"
          label="Where does it run?"
          :ui="{ label: 'font-semibold' }"
        >
          <URadioGroup
            v-model="kindValue"
            :items="kindItems"
            variant="card"
          />
        </UFormField>
        <PtTemplateChoice
          v-if="!relaunchOf"
          v-model="templateKey"
          :timezone="site?.site.timezone"
          @choose="chooseTemplate"
        />
        <UFormField
          label="Name"
          description="Shown on the site and in emails, e.g. Ramadan 2027."
          required
        >
          <UInput
            v-model="name"
            class="w-full"
          />
        </UFormField>
        <PtSetupForm
          v-model="setup"
          :template-key="templateKey"
          :lock-template="false"
          :with-length="false"
          :dated="kind === 'side'"
        />
        <UFormField
          label="Location (optional)"
          description="Where the people you pray for are. Fills {place} in prayer content."
        >
          <PtLocationSearch v-model="location" />
        </UFormField>
        <UFormField
          label="People group (optional)"
          description="Fills {people_group} in prayer content."
        >
          <UInput
            v-model="peopleGroup"
            class="w-full"
          />
        </UFormField>
      </div>
      <template #footer>
        <div class="flex items-center justify-end gap-3 flex-wrap">
          <p
            v-if="clash"
            class="text-sm text-error"
          >
            These dates overlap {{ clash.name }} ({{ ptCampaignDates(clash) }}).
            <template v-if="clash.start_mode === 'join' || clash.end_mode !== 'date'">
              It has no end date, so it holds every date from its start until it is ended. A side campaign can run alongside it.
            </template>
          </p>
          <UButton
            :icon="relaunchOf ? 'i-lucide-rotate-ccw' : 'i-lucide-plus'"
            :label="relaunchOf ? 'Relaunch' : 'Create campaign'"
            size="lg"
            :loading="saving"
            :disabled="name.trim().length < 2 || !setup.goal || !!clash || (kind === 'side' && !relaunchOf && (!setup.start_date || !setup.end_date))"
            @click="create"
          />
        </div>
      </template>
    </UCard>
  </div>
</template>
