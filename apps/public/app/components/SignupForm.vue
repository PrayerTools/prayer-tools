<script setup lang="ts">
import type { SignupFormView } from '~~/shared/view'
import type { SlotCounts } from '@prayertools/shared/coverage'
import { browserTimezone, newCommitment, timezones, formatTime, type CommitmentInput } from '~/utils/commitment'

const props = defineProps<{ form: SignupFormView }>()
const emit = defineEmits<{ joined: [verify: boolean] }>()
const { site, link, st } = useSite()
const { t } = useI18n()
const route = useRoute()

const campaign = computed(() => site.value.campaign!)
const tzItems = timezones()
const isCoverage = computed(() => campaign.value.goal === 'coverage')

// 24/7 campaigns pick each time on the coverage picker; without coverage data
// the plain time field is shown instead.
const { data: coverage, status: coverageStatus } = useFetch<SlotCounts>('/api/coverage.json', {
  query: { campaign: campaign.value.id },
  server: false,
  immediate: isCoverage.value
})
const usePicker = computed(() => isCoverage.value && coverageStatus.value !== 'error')

function blankCommitment(): CommitmentInput {
  const c = newCommitment(campaign.value.durationRule, campaign.value.defaultDuration, campaign.value.cadence)
  if (isCoverage.value) c.time = ''
  return c
}

const state = reactive({
  email: '',
  name: '',
  language: site.value.lang,
  timezone: 'UTC',
  commitments: [blankCommitment()] as CommitmentInput[],
  picks: [] as string[],
  siteUpdates: false,
  platformNews: false,
  custom: [] as string[],
  answers: {} as Record<string, string | boolean>,
  turnstile: '',
  idToken: null as null | { provider: 'google' | 'apple', token: string, email: string }
})
const sending = ref(false)
const showTimezone = ref(false)
const error = ref<string | null>(null)
const turnstile = ref<{ reset: () => void } | null>(null)
const signupEmail = useState<string | null>('pt-signup-email', () => null)

onMounted(() => {
  state.timezone = browserTimezone()
  const slots = typeof route.query.slots === 'string' ? route.query.slots.split(',') : []
  state.picks = slots.filter(s => !Number.isNaN(Date.parse(s))).slice(0, 100)
  if (state.picks.length) state.commitments = []
})

const languageItems = computed(() => site.value.languages.map(l => ({ label: l.native, value: l.code })))

function addCommitment() {
  state.commitments.push(blankCommitment())
}

function removePick(iso: string) {
  state.picks = state.picks.filter(p => p !== iso)
}

// Wall-clock time of an instant in the chosen timezone, as HH:MM.
function wallTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: state.timezone || undefined }).format(new Date(iso))
}

function pickLabel(iso: string): string {
  return new Intl.DateTimeFormat(site.value.lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: state.timezone || undefined }).format(new Date(iso))
}

async function submit() {
  error.value = null
  if (!state.commitments.length && !state.picks.length) {
    error.value = t('errors.commitments')
    return
  }
  if (state.commitments.some(c => !c.time)) {
    error.value = t('errors.time')
    return
  }
  sending.value = true
  try {
    const commitments: Record<string, unknown>[] = state.commitments.map(c => ({
      kind: 'recurring',
      frequency: c.frequency,
      days_of_week: c.frequency === 'weekly' ? c.days_of_week : [],
      time: c.time,
      duration_min: c.duration_min
    }))
    if (state.picks.length) {
      commitments.push({ kind: 'dates', dates: state.picks, time: wallTime(state.picks[0]!), duration_min: campaign.value.defaultDuration })
    }
    const res = await $fetch<{ ok: true, verify: boolean, referral_code: string | null }>('/api/signup', {
      method: 'POST',
      body: {
        campaign: campaign.value.slug,
        email: state.idToken?.email ?? state.email,
        name: state.name,
        language: state.language,
        timezone: state.timezone,
        commitments,
        consents: { site_updates: state.siteUpdates, platform_news: state.platformNews, custom: state.custom },
        answers: state.answers,
        referral: typeof route.query.r === 'string' ? route.query.r : null,
        from: typeof route.query.from === 'string' ? route.query.from : null,
        turnstile: state.turnstile,
        id_token: state.idToken ? { provider: state.idToken.provider, token: state.idToken.token } : null
      }
    })
    if (res.referral_code) rememberReferral(site.value.orgId, res.referral_code)
    signupEmail.value = state.idToken?.email ?? state.email
    // Before a campaign starts there is nothing to pray yet, so the signup page stays.
    if (campaign.value.state === 'upcoming') emit('joined', res.verify)
    else await navigateTo(`${link('pray', [], { lang: state.language })}?joined=1${res.verify ? '&verify=1' : ''}`)
  } catch (err) {
    const msg = (err as { data?: { statusMessage?: string } }).data?.statusMessage ?? 'generic'
    error.value = t(`errors.${msg}`) === `errors.${msg}` ? t('errors.generic') : t(`errors.${msg}`)
    turnstile.value?.reset()
  } finally {
    sending.value = false
  }
}

function onIdToken(provider: 'google' | 'apple', token: string) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')))
    if (payload.email) state.idToken = { provider, token, email: payload.email }
  } catch {
    error.value = t('errors.generic')
  }
}
</script>

<template>
  <form class="max-w-2xl mx-auto space-y-8" novalidate @submit.prevent="submit">
    <fieldset class="space-y-4">
          <legend class="text-lg font-semibold">{{ t('signup.contact_title') }}</legend>
          <SignInButtons
            v-if="(form.googleClientId || form.appleServicesId) && !state.idToken"
            :google-client-id="form.googleClientId"
            :apple-services-id="form.appleServicesId"
            @token="onIdToken"
          />
          <UFormField v-if="!state.idToken" :label="t('signup.email')" name="email" required>
            <UInput v-model="state.email" type="email" autocomplete="email" inputmode="email" required class="w-full" />
          </UFormField>
          <UAlert v-else color="success" variant="soft" icon="i-lucide-badge-check" :title="t('signup.signed_in_as', { email: state.idToken.email })" />
          <UFormField :label="t('signup.name')" :hint="t('common.optional')" name="name">
            <UInput v-model="state.name" autocomplete="name" class="w-full" />
          </UFormField>

          <UFormField v-for="f in form.fields" :key="f.key" :label="f.kind === 'checkbox' ? undefined : f.label" :name="`field-${f.key}`" :required="f.required">
            <UInput v-if="f.kind === 'text'" v-model="(state.answers[f.key] as string)" :required="f.required" class="w-full" :aria-label="f.label" />
            <USelect v-else-if="f.kind === 'select'" v-model="(state.answers[f.key] as string)" :items="f.options.map(o => ({ label: o.label, value: o.key }))" :placeholder="t('common.choose')" class="w-full" :aria-label="f.label" />
            <UCheckbox v-else v-model="(state.answers[f.key] as boolean)" :label="f.label" :required="f.required" />
          </UFormField>
        </fieldset>
    <fieldset class="space-y-4">
        <legend class="text-lg font-semibold">{{ t('signup.when_title') }}</legend>
        <p class="text-sm text-stone-600">{{ t(isCoverage ? 'signup.when_help_coverage' : 'signup.when_help') }}</p>
        <div v-for="(c, i) in state.commitments" :key="i" class="rounded-lg border border-stone-200 bg-white p-4 space-y-3">
          <CommitmentFields compact v-model="state.commitments[i]!" :duration-rule="campaign.durationRule" :durations="campaign.durations" :id-prefix="`c${i}`" :lang="site.lang" />
          <template v-if="usePicker">
            <CoveragePicker
              compact
              v-if="coverage"
              v-model="state.commitments[i]!.time"
              :counts="coverage"
              :tz="state.timezone"
              :weekdays="c.frequency === 'weekly' ? c.days_of_week : []"
              :duration="c.duration_min ?? campaign.defaultDuration"
              :lang="site.lang"
              :id-prefix="`c${i}`"
            />
            <p v-else class="text-sm text-stone-600">{{ t('common.loading') }}</p>
          </template>
          <p v-if="usePicker && /^\d{2}:\d{2}$/.test(c.time)" class="rounded-lg bg-stone-50 border border-stone-200 p-3 text-sm font-medium" aria-live="polite">{{ t('picker.commitment_summary', { frequency: t(c.frequency === 'daily' ? 'commitment.daily' : 'commitment.weekly'), time: formatTime(c.time, site.lang), duration: c.duration_min ?? campaign.defaultDuration, timezone: state.timezone }) }}</p>
          <UButton v-if="state.commitments.length > 1 || state.picks.length" variant="link" color="neutral" icon="i-lucide-x" :label="t('commitment.remove')" @click="state.commitments.splice(i, 1)" />
        </div>
        <div v-if="state.picks.length" class="rounded-lg border border-stone-200 bg-white p-4">
          <p class="font-medium">{{ t('signup.picked_times') }}</p>
          <ul class="mt-2 space-y-1">
            <li v-for="p in state.picks" :key="p" class="flex items-center gap-2">
              <span>{{ pickLabel(p) }}</span>
              <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-x" :aria-label="t('commitment.remove')" @click="removePick(p)" />
            </li>
          </ul>
        </div>
        <div class="flex flex-wrap gap-3">
          <UButton v-if="campaign.startMode !== 'join'" variant="link" icon="i-lucide-plus" class="px-0 text-sm" :label="t('signup.add_time')" @click="addCommitment" />
          <UButton v-if="campaign.goal === 'coverage'" variant="ghost" icon="i-lucide-calendar" :label="t('signup.pick_slots')" :to="link('coverage')" />
        </div>
        <div class="space-y-3">
          <p class="text-sm text-stone-600">{{ t('signup.times_shown', { timezone: state.timezone }) }}
            <button type="button" class="ms-2 text-(--ui-primary) underline underline-offset-4" :aria-expanded="showTimezone" @click="showTimezone = !showTimezone">{{ t('signup.change_timezone') }}</button>
          </p>
          <UFormField v-if="showTimezone" :label="t('signup.timezone')" name="timezone" :help="t('signup.timezone_help')">
          <USelectMenu v-model="state.timezone" :items="tzItems" class="w-full" />
        </UFormField>
        </div>
      </fieldset>
    <div class="space-y-6 border-t border-stone-200 pt-6">
                  <UFormField v-if="languageItems.length > 1" :label="t('signup.language')" name="language">
            <USelect v-model="state.language" :items="languageItems" class="w-full" />
          </UFormField>
        <fieldset class="space-y-3">
          <legend class="text-sm font-semibold">{{ t('signup.consent_title') }}</legend>
          <UCheckbox v-model="state.siteUpdates" :label="t('consent.site_updates', { site: site.name })" />
          <UCheckbox v-model="state.platformNews" :label="t('consent.platform_news')" />
          <UCheckbox
            v-for="o in form.consentOptions"
            :key="o.key"
            :model-value="state.custom.includes(o.key)"
            :label="o.label"
            @update:model-value="v => v ? state.custom.push(o.key) : state.custom.splice(state.custom.indexOf(o.key), 1)"
          />
          <p class="text-xs text-stone-500">{{ t('signup.reminders_note') }}</p>
        </fieldset>
    </div>
    <TurnstileWidget ref="turnstile" v-model="state.turnstile" :site-key="site.turnstileSiteKey" />
    <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-circle-alert" :title="error" role="alert" />
    <div class="space-y-3">
      <UButton type="submit" size="xl" block :loading="sending" :label="st('landing.signup.title')" />
      <p class="text-center text-sm text-stone-600">{{ t(state.idToken ? 'signup.reassurance_verified' : 'signup.reassurance') }}</p>
    </div>
  </form>
</template>
