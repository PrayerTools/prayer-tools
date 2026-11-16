<script setup lang="ts">
import type { MarketingDraft, MarketingLanguage, MarketingStep, MarketingVariable, MarketingVersions } from '../../utils/marketing-ui'
import { MARKETING_FAILED_REASONS, MARKETING_PAUSE_REASONS, MARKETING_SKIP_REASONS, MARKETING_STATUS, marketingDate, marketingErrorMessage, marketingHasText } from '../../utils/marketing-ui'

definePageMeta({ middleware: 'auth' })

interface Meta { site: { id: string, slug: string, name: string }, languages: MarketingLanguage[], defaultLanguage: string, variables: MarketingVariable[], canSend: boolean }
interface Email {
  id: string
  parent_id: string | null
  status: string
  versions: MarketingVersions
  source_language: string
  audiences: string[]
  scheduled_at: string | null
  started_at: string | null
  finished_at: string | null
  paused_reason: string | null
  failed_reason: string | null
  recipients: number
  sent: number
  skipped: number
  failed: number
  unsubscribes: number
}
interface Audience { key: string, label: string, description?: string, count: number, notConsented: number }

const route = useRoute()
const toast = useToast()
const id = ref(String(route.params.id))
const meta = ref<Meta | null>(null)
const email = ref<Email | null>(null)
const pending = ref(0)
const skipReasons = ref<Record<string, number>>({})
const draft = ref<MarketingDraft>({ versions: {}, source_language: 'en', audiences: [] })
const audiences = ref<Audience[]>([])
const combined = ref(0)
const error = ref('')
const saving = ref(false)
const sending = ref(false)
const acting = ref(false)

const isDraft = computed(() => !email.value || email.value.status === 'draft')
const editable = computed(() => isDraft.value && !!meta.value?.canSend)

async function loadEmail() {
  if (id.value === 'new') return
  const res = await $fetch<{ email: Email, pending: number, skipReasons: Record<string, number> }>(`/api/marketing/emails/${id.value}`)
  email.value = res.email
  pending.value = res.pending
  skipReasons.value = res.skipReasons
  if (res.email.status === 'draft' || !draft.value.versions[res.email.source_language]) {
    draft.value = { versions: res.email.versions, source_language: res.email.source_language, audiences: res.email.audiences }
  }
}

async function loadAudiences() {
  try {
    const res = await $fetch<{ audiences: Audience[], combined: number }>('/api/marketing/audiences', { query: { selected: draft.value.audiences.join(',') } })
    audiences.value = res.audiences
    combined.value = res.combined
  } catch (err) {
    error.value = marketingErrorMessage(err)
  }
}

onMounted(async () => {
  try {
    meta.value = await $fetch<Meta>('/api/marketing/meta')
    draft.value.source_language = meta.value.defaultLanguage
    await loadEmail()
    await loadAudiences()
  } catch (err) {
    error.value = marketingErrorMessage(err)
  }
})

let timer: ReturnType<typeof setTimeout> | null = null
watch(() => [...draft.value.audiences], () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(loadAudiences, 300)
})

// Live results while an email is going out.
let poll: ReturnType<typeof setInterval> | null = null
watch(() => email.value?.status, (s) => {
  if (poll) clearInterval(poll)
  poll = s === 'sending' || s === 'scheduled' ? setInterval(() => loadEmail().catch(() => {}), 5000) : null
}, { immediate: true })
onBeforeUnmount(() => {
  if (poll) clearInterval(poll)
  if (timer) clearTimeout(timer)
})

function toggleAudience(key: string, on: boolean | 'indeterminate') {
  const set = new Set(draft.value.audiences)
  if (on === true) set.add(key)
  else set.delete(key)
  draft.value.audiences = [...set]
}

// A draft is written in steps; the step in view is kept in the URL, so it holds when a new email gets its id.
const STEPS: MarketingStep[] = ['details', 'content', 'review']
const step = computed<MarketingStep>(() => STEPS.find(s => s === route.query.step) ?? 'details')

// What each step still needs before the next one opens.
const stepProblems = computed<Record<MarketingStep, string[]>>(() => {
  const src = draft.value.versions[draft.value.source_language]
  return {
    details: [...(src?.subject.trim() ? [] : ['Add a subject.']), ...(draft.value.audiences.length ? [] : ['Choose at least one audience.'])],
    content: marketingHasText(src?.content) ? [] : ['Write the email.'],
    review: []
  }
})
const problems = computed(() => STEPS.flatMap(s => stepProblems.value[s]))

const stepTabs = computed(() => {
  const needsDetails = stepProblems.value.details.length > 0
  return [
    { label: 'Subject and audience', value: 'details', icon: 'i-lucide-users' },
    { label: 'Write', value: 'content', icon: 'i-lucide-pen-line', disabled: needsDetails },
    { label: 'Preview and send', value: 'review', icon: 'i-lucide-send', disabled: needsDetails || stepProblems.value.content.length > 0 }
  ]
})

const chosenAudiences = computed(() => audiences.value.filter(a => draft.value.audiences.includes(a.key)).map(a => a.label).join(', '))

function setStep(to: MarketingStep) {
  return navigateTo({ query: { ...route.query, step: to } }, { replace: true })
}

async function saveAndContinue() {
  const to = STEPS[STEPS.indexOf(step.value) + 1]
  if (!to || !(await save(true, to))) return
  await setStep(to)
}

async function save(quiet = false, openStep: MarketingStep = step.value): Promise<boolean> {
  saving.value = true
  try {
    const body = { versions: draft.value.versions, source_language: draft.value.source_language, audiences: draft.value.audiences }
    if (id.value === 'new') {
      const res = await $fetch<{ id: string }>('/api/marketing/emails', { method: 'POST', body })
      id.value = res.id
      await navigateTo({ path: `/marketing/${res.id}`, query: { step: openStep } }, { replace: true })
    } else {
      await $fetch(`/api/marketing/emails/${id.value}`, { method: 'PUT', body })
    }
    if (!quiet) toast.add({ title: 'Saved', icon: 'i-lucide-save', color: 'success' })
    return true
  } catch (err) {
    toast.add({ title: 'Could not save', description: marketingErrorMessage(err), color: 'error' })
    return false
  } finally {
    saving.value = false
  }
}

async function send(at: string | null) {
  sending.value = true
  try {
    if (!(await save(true))) return
    await $fetch(`/api/marketing/emails/${id.value}/schedule`, { method: 'POST', body: { scheduled_at: at } })
    toast.add({ title: at ? 'Scheduled' : 'Sending — results appear here as it goes out', icon: 'i-lucide-send', color: 'success' })
    await loadEmail()
  } catch (err) {
    toast.add({ title: 'Could not send', description: marketingErrorMessage(err), color: 'error' })
  } finally {
    sending.value = false
  }
}

async function act(action: 'pause' | 'resume' | 'cancel' | 'unschedule') {
  acting.value = true
  try {
    await $fetch(`/api/marketing/emails/${id.value}/action`, { method: 'POST', body: { action } })
    await loadEmail()
  } catch (err) {
    toast.add({ title: 'That didn\'t work', description: marketingErrorMessage(err), color: 'error' })
  } finally {
    acting.value = false
  }
}

async function remove() {
  try {
    await $fetch(`/api/marketing/emails/${id.value}`, { method: 'DELETE' })
    await navigateTo('/marketing')
  } catch (err) {
    toast.add({ title: 'Could not delete', description: marketingErrorMessage(err), color: 'error' })
  }
}

const previewFn = (lang: string) => $fetch<{ subject: string, html: string, lang: string }>('/api/marketing/preview', {
  method: 'POST',
  body: { versions: draft.value.versions, source_language: draft.value.source_language, lang }
})
const testFn = async (lang: string) => (await $fetch<{ to: string }>('/api/marketing/test', {
  method: 'POST',
  body: { versions: draft.value.versions, source_language: draft.value.source_language, lang }
})).to
</script>

<template>
  <div class="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
    <div class="flex flex-wrap items-center gap-3">
      <UButton
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        to="/marketing"
        aria-label="Back to emails"
      />
      <h1 class="text-2xl font-semibold flex-1 truncate">
        {{ draft.versions[draft.source_language]?.subject || (id === 'new' ? 'New email' : 'Untitled email') }}
      </h1>
      <UBadge
        v-if="email"
        :label="MARKETING_STATUS[email.status]?.label ?? email.status"
        :color="MARKETING_STATUS[email.status]?.color ?? 'neutral'"
        variant="subtle"
        size="lg"
      />
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      :description="error"
    />

    <template v-if="email && !isDraft">
      <UAlert
        v-if="email.parent_id"
        color="info"
        variant="soft"
        icon="i-lucide-send"
        description="Part of a send to several sites. Each person gets one email, from the site they joined most recently."
      />
      <UAlert
        v-if="email.status === 'paused' && email.paused_reason"
        color="warning"
        variant="soft"
        icon="i-lucide-circle-pause"
        :description="MARKETING_PAUSE_REASONS[email.paused_reason] ?? email.paused_reason"
      />
      <UAlert
        v-if="email.status === 'failed' && email.failed_reason"
        color="error"
        variant="soft"
        icon="i-lucide-octagon-x"
        :description="MARKETING_FAILED_REASONS[email.failed_reason] ?? email.failed_reason"
      />
      <p class="text-sm text-(--ui-text-muted)">
        <span v-if="email.status === 'scheduled'">Goes out {{ marketingDate(email.scheduled_at) }}.</span>
        <span v-else-if="email.started_at">Started {{ marketingDate(email.started_at) }}<span v-if="email.finished_at">, finished {{ marketingDate(email.finished_at) }}</span>.</span>
      </p>
      <MarketingStats :stats="{ ...email, pending }" />
      <div
        v-if="Object.keys(skipReasons).length"
        class="text-sm space-y-1"
      >
        <p class="font-medium">
          Skipped
        </p>
        <p
          v-for="(n, reason) in skipReasons"
          :key="reason"
          class="text-(--ui-text-muted)"
        >
          {{ MARKETING_SKIP_REASONS[reason] ?? reason }}: {{ n.toLocaleString() }}
        </p>
      </div>
      <div
        v-if="meta?.canSend"
        class="flex flex-wrap gap-2"
      >
        <UButton
          v-if="email.status === 'scheduled' && !email.parent_id"
          label="Back to draft"
          icon="i-lucide-pencil"
          color="neutral"
          variant="outline"
          :loading="acting"
          @click="act('unschedule')"
        />
        <UButton
          v-if="email.status === 'sending'"
          label="Pause"
          icon="i-lucide-pause"
          color="neutral"
          variant="outline"
          :loading="acting"
          @click="act('pause')"
        />
        <UButton
          v-if="email.status === 'paused'"
          label="Resume"
          icon="i-lucide-play"
          :loading="acting"
          @click="act('resume')"
        />
        <UButton
          v-if="['scheduled', 'sending', 'paused'].includes(email.status)"
          label="Cancel"
          icon="i-lucide-x"
          color="error"
          variant="soft"
          :loading="acting"
          @click="act('cancel')"
        />
      </div>
      <USeparator label="The email" />
    </template>

    <template v-if="meta">
      <UTabs
        v-if="editable"
        :model-value="step"
        :items="stepTabs"
        :content="false"
        class="w-full"
        @update:model-value="v => setStep(v as MarketingStep)"
      />

      <MarketingComposer
        v-model="draft"
        :languages="meta.languages"
        :variables="meta.variables"
        :preview="previewFn"
        :send-test="testFn"
        :disabled="!editable"
        :step="editable ? step : undefined"
      />

      <template v-if="isDraft">
        <div
          v-if="!editable || step === 'details'"
          class="space-y-3"
        >
          <h2 class="text-lg font-semibold">
            Who gets it
          </h2>
          <p class="text-sm text-(--ui-text-muted)">
            Only people who opted in on this site are counted and emailed. Addresses that bounced or complained anywhere are left out.
          </p>
          <div class="grid sm:grid-cols-2 gap-2">
            <UCheckbox
              v-for="a in audiences"
              :key="a.key"
              variant="card"
              class="p-3"
              :class="{ 'cursor-pointer': editable }"
              :model-value="draft.audiences.includes(a.key)"
              :label="`${a.label} · ${a.count.toLocaleString()}`"
              :description="a.description"
              :disabled="!editable"
              @update:model-value="v => toggleAudience(a.key, v)"
            />
          </div>
          <p
            v-if="draft.audiences.length"
            class="text-sm font-medium"
          >
            {{ combined.toLocaleString() }} {{ combined === 1 ? 'person' : 'people' }} will get this email.
          </p>
        </div>

        <div
          v-if="editable"
          class="space-y-3 border-t border-(--ui-border) pt-4"
        >
          <template v-if="step === 'review'">
            <p
              v-if="draft.audiences.length"
              class="text-sm"
            >
              <span class="font-medium">{{ combined.toLocaleString() }} {{ combined === 1 ? 'person' : 'people' }} will get this email.</span>
              <span class="text-(--ui-text-muted)"> {{ chosenAudiences }}</span>
            </p>
            <MarketingSchedule
              :loading="sending"
              :problems="problems"
              :targets="meta ? [{ name: meta.site.name, count: combined }] : []"
              @send="send"
            />
          </template>
          <div class="flex flex-wrap items-center gap-2">
            <UButton
              label="Save draft"
              icon="i-lucide-save"
              color="neutral"
              variant="outline"
              :loading="saving"
              @click="save()"
            />
            <UButton
              v-if="id !== 'new'"
              label="Delete draft"
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              @click="remove"
            />
            <template v-if="step !== 'review'">
              <div class="flex-1" />
              <span
                v-if="stepProblems[step].length"
                class="text-sm text-(--ui-text-muted)"
              >{{ stepProblems[step].join(' ') }}</span>
              <UButton
                label="Save and continue"
                trailing-icon="i-lucide-arrow-right"
                :loading="saving"
                :disabled="stepProblems[step].length > 0"
                @click="saveAndContinue"
              />
            </template>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
