<script setup lang="ts">
// New campaign, or a relaunch: a new campaign on the same site that starts
// from the previous one's answers and content. A main campaign shows at the
// site's address, one at a time; a side campaign runs beside it on fixed
// dates at its own address.
import { applyTemplate, overlappingCampaign, suggestedStartDate } from '@prayertools/shared/setup'
import { addDays, todayIn } from '@prayertools/shared/dates'
import type { SetupState } from '../../../components/PtSetupForm.vue'
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
const setup = ref<SetupState>({ start_mode: 'date', start_date: null, end_mode: 'date', end_date: null, length_days: null, goal: 'people', cadence: 'daily', track_time: false, goal_target: null, slot_min: null })
watch(previous, (p) => {
  const c = p?.campaign
  if (!c) return
  templateKey.value = c.template_key ?? 'generic'
  kind.value = c.kind
  name.value = c.name.replace(/\d{4}/, (y: string) => String(Number(y) + 1))
  setup.value = { start_mode: c.start_mode, start_date: null, end_mode: c.end_mode, end_date: null, length_days: c.length_days, goal: c.goal, cadence: c.cadence, track_time: c.track_time, goal_target: c.goal_target, slot_min: c.slot_min ?? null }
}, { immediate: true })

const templateKeys = computed(() => meta.value?.templates.map(t => t.key) ?? Object.keys(PT_LABELS.template))
const templateLength = () => meta.value?.templates.find(t => t.key === templateKey.value)?.setup.length_days as number | undefined

function chooseTemplate(key: string) {
  templateKey.value = key
  const t = meta.value?.templates.find(x => x.key === key)
  if (!t) return
  setup.value = { ...setup.value, ...(t.setup as Partial<SetupState>) }
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
  const answers = applyTemplate(templateKey.value, { ...setup.value, end_date: setup.value.end_date ?? undefined })
  const mine = { ...answers, timezone: site.value?.site.timezone ?? 'UTC' }
  return overlappingCampaign(mine, kind.value, existing.value?.campaigns ?? [])
})
// While a main campaign is running or upcoming, a new campaign starts as a
// side campaign from scratch; otherwise as a main campaign on the site's template.
const prefilled = ref(false)
watch([site, meta, existing], ([s, m, e]) => {
  if (prefilled.value || relaunchOf.value || !s || !m || !e) return
  prefilled.value = true
  if (!route.query.kind && e.campaigns.some(c => c.kind !== 'side' && c.status !== 'ended')) kind.value = 'side'
  chooseTemplate(kind.value === 'side' ? 'generic' : (s.site.template_key ?? 'generic'))
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
    const body: Record<string, unknown> = { ...setup.value, name: name.value, template_key: templateKey.value, kind: kind.value }
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
        <section
          v-if="!relaunchOf"
          class="space-y-3"
        >
          <div>
            <h2 class="font-semibold">
              Choose a template
            </h2>
            <p class="text-sm text-muted">
              A template fills in the answers below. You can change any of them.
            </p>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <button
              v-for="key in templateKeys"
              :key="key"
              type="button"
              class="text-start rounded-lg border p-4 transition-colors"
              :class="templateKey === key ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-default hover:bg-elevated'"
              :aria-pressed="templateKey === key"
              @click="chooseTemplate(key)"
            >
              <div class="flex items-center gap-2 font-medium">
                <UIcon
                  :name="PT_TEMPLATE_ICONS[key] ?? 'i-lucide-sparkles'"
                  class="size-5 text-primary"
                />
                {{ PT_LABELS.template[key] ?? key }}
              </div>
              <p class="text-sm text-muted mt-1">
                {{ PT_LABELS.templateDescription[key] }}
              </p>
            </button>
          </div>
        </section>
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
          :dated="kind === 'side'"
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
            :disabled="name.trim().length < 2 || !!clash || (kind === 'side' && !relaunchOf && (!setup.start_date || !setup.end_date))"
            @click="create"
          />
        </div>
      </template>
    </UCard>
  </div>
</template>
