import { suggestedStartDate } from '@prayertools/shared/setup'
import { addDays, todayIn } from '@prayertools/shared/dates'
import type { SitePlaceWording } from '@prayertools/shared/place'
import type { SetupDraft } from '../components/PtSetupForm.vue'
import type { PtLocation } from '../components/PtLocationSearch.vue'
import type { PtCampaign } from '../utils/pt-campaign-ui'

// A campaign's answers while it is created or edited (site setup, New
// campaign, the campaign page), edited with PtCampaignFields.
export interface PtCampaignDraft {
  templateKey: string
  name: string
  setup: SetupDraft
  timezone: string
  location: PtLocation | null
  peopleGroup: string
  placeWording: SitePlaceWording
}

export interface PtCampaignDraftOptions {
  // The name when the template suggests none.
  fallbackName?: () => string
  // A relaunch keeps the previous campaign's length rather than the template's.
  relaunch?: () => boolean
}

export function usePtCampaignDraft(opts: PtCampaignDraftOptions = {}) {
  const { data: meta } = usePtMeta()
  const draft = ref<PtCampaignDraft>({
    templateKey: 'generic',
    name: '',
    setup: { start_mode: 'date', start_date: null, end_mode: 'date', end_date: null, length_days: null, goal: null, cadence: 'daily', track_time: false, goal_target: null, slot_min: null },
    timezone: 'UTC',
    location: null,
    peopleGroup: '',
    placeWording: {}
  })
  // The name the chosen template suggested; a name the user typed stays when the template changes.
  const suggestedName = ref('')

  // Starts from an existing campaign; `dates: false` (a relaunch) leaves its dates out.
  function fillFrom(c: PtCampaign, { dates = true } = {}) {
    draft.value = {
      templateKey: c.template_key ?? 'generic',
      name: c.name,
      setup: { start_mode: c.start_mode, start_date: dates ? c.start_date : null, end_mode: c.end_mode, end_date: dates ? c.end_date : null, length_days: c.length_days, goal: c.goal, cadence: c.cadence, track_time: c.track_time, goal_target: c.goal_target, slot_min: c.slot_min ?? null },
      timezone: c.timezone,
      location: c.place_name ? { name: c.place_name, latitude: c.latitude, longitude: c.longitude } : null,
      peopleGroup: c.people_group ?? '',
      placeWording: { ...c.place_wording }
    }
    suggestedName.value = ''
  }

  // A template fills its setup answers and suggested start date.
  function chooseTemplate(key: string) {
    const d = draft.value
    d.templateKey = key
    const t = meta.value?.templates.find(x => x.key === key)
    if (!t) return
    d.setup = { ...d.setup, ...(t.setup as Partial<SetupDraft>) }
    if (t.setup.length_days && d.setup.start_mode === 'date') d.setup.length_days = null
    const start = d.setup.start_mode === 'date' ? suggestedStartDate(key, todayIn(d.timezone)) : null
    if (start) d.setup.start_date = start
    if (!d.name.trim() || d.name === suggestedName.value) {
      suggestedName.value = key === 'ramadan' && start ? `Ramadan ${start.slice(0, 4)}` : (opts.fallbackName?.() ?? '')
      d.name = suggestedName.value
    }
    fillEndDate()
  }

  // Templates with a fixed length end their dated campaigns that many days after the start.
  function fillEndDate() {
    const d = draft.value
    const days = meta.value?.templates.find(x => x.key === d.templateKey)?.setup.length_days as number | undefined
    if (opts.relaunch?.() || d.templateKey === 'generic' || !days || d.setup.start_mode !== 'date' || !d.setup.start_date) return
    d.setup.end_date = addDays(d.setup.start_date, days - 1)
  }
  watch(() => draft.value.setup.start_date, fillEndDate)

  // The campaign routes' request body. A relaunch without an end date leaves
  // it to the server, which keeps the previous campaign's length.
  function toBody(): Record<string, unknown> {
    const d = draft.value
    const body: Record<string, unknown> = {
      ...d.setup,
      name: d.name.trim(),
      template_key: d.templateKey,
      timezone: d.timezone,
      people_group: d.peopleGroup.trim() || null,
      place_name: d.location?.name ?? null,
      latitude: d.location?.latitude ?? null,
      longitude: d.location?.longitude ?? null,
      place_wording: d.location ? d.placeWording : {}
    }
    if (opts.relaunch?.() && !d.setup.end_date) delete body.end_date
    return body
  }

  return { draft, fillFrom, chooseTemplate, toBody }
}
