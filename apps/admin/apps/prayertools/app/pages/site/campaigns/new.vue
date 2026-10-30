<script setup lang="ts">
// New campaign, or a relaunch: a new campaign on the same site that starts
// from the previous one's answers and content. A main campaign shows at the
// site's address, one at a time; a side campaign runs beside it on fixed
// dates at its own address. Its place and people group start as the current
// campaign's (or, for a relaunch, the previous one's). How often there is new
// content, and a personal-start campaign's length, are chosen in its setup
// steps.
import { applyTemplate, offeredTemplates, overlappingCampaign } from '@prayertools/shared/setup'
import { todayIn } from '@prayertools/shared/dates'
import type { PtCampaign } from '../../../utils/pt-campaign-ui'

definePageMeta({ middleware: 'auth' })

const route = useRoute()
const relaunchOf = computed(() => (typeof route.query.relaunch === 'string' ? route.query.relaunch : null))
const { data: site, slug } = usePtSite()
const { data: meta } = usePtMeta()
const toast = usePtToast()
const { data: previous } = useFetch<{ campaign: PtCampaign }>(() => `/api/pt/campaigns/${relaunchOf.value}`, { immediate: !!relaunchOf.value, key: `pt-relaunch-${relaunchOf.value}` })

const kind = ref<'side' | null>(route.query.kind === 'side' ? 'side' : null)
const { draft, fillFrom, chooseTemplate, toBody } = usePtCampaignDraft({ relaunch: () => !!relaunchOf.value })
watch(previous, (p) => {
  const c = p?.campaign
  if (!c) return
  fillFrom(c, { dates: false })
  kind.value = c.kind
  draft.value.name = c.name.replace(/\d{4}/, (y: string) => String(Number(y) + 1))
}, { immediate: true })

// A site runs one main campaign at a time: the dates other main campaigns hold, and the one these dates would overlap.
const { data: existing } = usePtCampaignList()
const booked = computed(() => kind.value === 'side' ? [] : (existing.value?.campaigns ?? []).filter(c => c.status !== 'ended' && c.kind !== 'side'))
const clash = computed(() => {
  const d = draft.value
  const answers = applyTemplate(d.templateKey, { ...d.setup, goal: d.setup.goal ?? undefined, end_date: d.setup.end_date ?? undefined })
  return overlappingCampaign({ ...answers, timezone: d.timezone }, kind.value, existing.value?.campaigns ?? [])
})
// While a main campaign is running or upcoming, a new campaign starts as a
// side campaign from scratch; otherwise as a main campaign on the current
// campaign's template, when that template is on offer. Either way it starts
// with the current campaign's timezone, place and people group.
const prefilled = ref(false)
watch([site, meta, existing], ([s, m, e]) => {
  if (prefilled.value || relaunchOf.value || !s || !m || !e) return
  prefilled.value = true
  if (!route.query.kind && e.campaigns.some(c => c.kind !== 'side' && c.status !== 'ended')) kind.value = 'side'
  const current = s.currentCampaign as PtCampaign | null
  draft.value.timezone = current?.timezone ?? s.site.timezone
  draft.value.location = current?.place_name ? { name: current.place_name, latitude: current.latitude, longitude: current.longitude } : null
  draft.value.peopleGroup = current?.people_group ?? ''
  draft.value.placeWording = { ...current?.place_wording }
  const template = current?.template_key && offeredTemplates(todayIn(s.site.timezone)).includes(current.template_key) ? current.template_key : 'generic'
  chooseTemplate(kind.value === 'side' ? 'generic' : template)
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
    const body: Record<string, unknown> = { ...toBody(), kind: kind.value }
    if (relaunchOf.value) body.relaunchOf = relaunchOf.value
    const res = await $fetch<{ campaign: { id: string, published_at: string | null } }>('/api/pt/campaigns', { method: 'POST', body })
    await refreshNuxtData(ptCampaignsKey(slug.value))
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
        <PtCampaignFields
          v-model="draft"
          :with-template="!relaunchOf"
          :with-cadence="false"
          :with-length="false"
          :dated="kind === 'side'"
          :languages="site?.site.languages"
          @choose="chooseTemplate"
        />
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
            :disabled="draft.name.trim().length < 2 || !draft.setup.goal || !!clash || (kind === 'side' && !relaunchOf && (!draft.setup.start_date || !draft.setup.end_date))"
            @click="create"
          />
        </div>
      </template>
    </UCard>
  </div>
</template>
