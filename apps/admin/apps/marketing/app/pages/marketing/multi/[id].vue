<script setup lang="ts">
import type { MarketingDraft, MarketingLanguage, MarketingVariable, MarketingVersions } from '../../../utils/marketing-ui'
import { MARKETING_PAUSE_REASONS, MARKETING_STATUS, marketingDate, marketingErrorMessage, marketingHasText } from '../../../utils/marketing-ui'

definePageMeta({ middleware: 'auth', tenantExempt: true })

interface Site { id: string, slug: string, name: string, languages: string[], defaultLanguage: string }
interface Parent {
  id: string
  status: string
  versions: MarketingVersions
  source_language: string
  org_ids: string[]
  audiences: string[]
  scheduled_at: string | null
  started_at: string | null
  finished_at: string | null
  people: number
  recipients: number
  sent: number
  skipped: number
  failed: number
  unsubscribes: number
}
interface SitePart {
  id: string
  slug: string
  name: string
  email: { id: string, status: string, paused_reason: string | null, sent: number, skipped: number, failed: number, unsubscribes: number } | null
}
interface AudienceRow { key: string, label: string, description?: string, count: number }

const route = useRoute()
const toast = useToast()
const id = ref(String(route.params.id))
const sites = ref<Site[]>([])
const allLanguages = ref<MarketingLanguage[]>([])
const variables = ref<MarketingVariable[]>([])
const orgIds = ref<string[]>([])
const draft = ref<MarketingDraft>({ versions: {}, source_language: 'en', audiences: [] })
const parent = ref<Parent | null>(null)
const parts = ref<SitePart[]>([])
const audienceSites = ref<{ site: { id: string, name: string }, audiences: AudienceRow[], combined: number }[]>([])
const people = ref(0)
const previewSite = ref<string | undefined>(undefined)
const error = ref('')
const saving = ref(false)
const sending = ref(false)
const acting = ref(false)

const isDraft = computed(() => !parent.value || parent.value.status === 'draft')

const languages = computed(() => {
  const chosen = sites.value.filter(s => orgIds.value.includes(s.id))
  const codes = new Set((chosen.length ? chosen : sites.value).flatMap(s => s.languages))
  return allLanguages.value.filter(l => codes.has(l.code))
})

const siteItems = computed(() => sites.value.filter(s => orgIds.value.includes(s.id)).map(s => ({ label: s.name, value: s.id })))

// Audience keys across the chosen sites; site-specific options (custom consents
// and single campaigns) name their site.
const audienceKeys = computed(() => {
  const map = new Map<string, { key: string, label: string, description?: string, perSite: { name: string, count: number }[] }>()
  for (const s of audienceSites.value) {
    for (const a of s.audiences) {
      const entry = map.get(a.key) ?? { key: a.key, label: a.key.startsWith('custom:') || a.key.startsWith('campaign:') ? `${a.label} (${s.site.name})` : a.label, description: a.description, perSite: [] }
      entry.perSite.push({ name: s.site.name, count: a.count })
      map.set(a.key, entry)
    }
  }
  return [...map.values()]
})

async function loadParent() {
  if (id.value === 'new') return
  const res = await $fetch<{ parent: Parent, sites: SitePart[] }>(`/api/marketing/multi/${id.value}`)
  parent.value = res.parent
  parts.value = res.sites
  if (res.parent.status === 'draft' || !draft.value.versions[res.parent.source_language]) {
    draft.value = { versions: res.parent.versions, source_language: res.parent.source_language, audiences: res.parent.audiences }
    orgIds.value = res.parent.org_ids
  }
}

// "Send to several sites" on a Library template starts the send from it.
async function startFromTemplate(templateId: string) {
  const { templates } = await $fetch<{ templates: { id: string, versions: MarketingVersions, source_language: string }[] }>('/api/marketing/templates')
  const t = templates.find(x => x.id === templateId)
  if (!t) return
  const codes = allLanguages.value.map(l => l.code)
  const versions: MarketingVersions = {}
  for (const [lang, v] of Object.entries(t.versions)) if (codes.includes(lang)) versions[lang] = v
  if (!Object.keys(versions).length) return
  const source = versions[t.source_language] ? t.source_language : Object.keys(versions)[0]!
  draft.value = { ...draft.value, versions, source_language: source }
}

async function loadAudiences() {
  if (!orgIds.value.length || !isDraft.value) {
    audienceSites.value = []
    people.value = 0
    return
  }
  try {
    const res = await $fetch<{ sites: typeof audienceSites.value, people: number }>('/api/marketing/multi/audiences', { method: 'POST', body: { org_ids: orgIds.value, selected: draft.value.audiences } })
    audienceSites.value = res.sites
    people.value = res.people
  } catch (err) {
    error.value = marketingErrorMessage(err)
  }
}

onMounted(async () => {
  try {
    const res = await $fetch<{ sites: Site[], languages: MarketingLanguage[], variables: MarketingVariable[] }>('/api/marketing/multi/sites')
    sites.value = res.sites
    allLanguages.value = res.languages
    variables.value = res.variables
    draft.value.source_language = res.sites[0]?.defaultLanguage ?? res.languages[0]?.code ?? 'en'
    await loadParent()
    if (id.value === 'new' && typeof route.query.template === 'string') await startFromTemplate(route.query.template)
    await loadAudiences()
  } catch (err) {
    error.value = marketingErrorMessage(err)
  }
})

let timer: ReturnType<typeof setTimeout> | null = null
watch(() => [...orgIds.value, '|', ...draft.value.audiences], () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(loadAudiences, 300)
})
watch(siteItems, (items) => {
  if (!items.some(i => i.value === previewSite.value)) previewSite.value = items[0]?.value
}, { immediate: true })
watch(languages, (langs) => {
  if (langs.length && !langs.some(l => l.code === draft.value.source_language)) draft.value.source_language = langs[0]!.code
})

let poll: ReturnType<typeof setInterval> | null = null
watch(() => parent.value?.status, (s) => {
  if (poll) clearInterval(poll)
  poll = s === 'sending' || s === 'scheduled' ? setInterval(() => loadParent().catch(() => {}), 5000) : null
}, { immediate: true })
onBeforeUnmount(() => {
  if (poll) clearInterval(poll)
  if (timer) clearTimeout(timer)
})

function toggle(list: 'sites' | 'audiences', key: string, on: boolean | 'indeterminate') {
  const current = list === 'sites' ? orgIds.value : draft.value.audiences
  const set = new Set(current)
  if (on === true) set.add(key)
  else set.delete(key)
  if (list === 'sites') orgIds.value = [...set]
  else draft.value.audiences = [...set]
}

const problems = computed(() => {
  const src = draft.value.versions[draft.value.source_language]
  const out: string[] = []
  if (!orgIds.value.length) out.push('Choose at least one site.')
  if (!src?.subject.trim()) out.push('Add a subject.')
  if (!marketingHasText(src?.content)) out.push('Write the email.')
  if (!draft.value.audiences.length) out.push('Choose at least one audience.')
  return out
})

async function save(quiet = false): Promise<boolean> {
  saving.value = true
  try {
    const body = { versions: draft.value.versions, source_language: draft.value.source_language, audiences: draft.value.audiences, org_ids: orgIds.value }
    if (id.value === 'new') {
      const res = await $fetch<{ id: string }>('/api/marketing/multi', { method: 'POST', body })
      id.value = res.id
      await navigateTo(`/marketing/multi/${res.id}`, { replace: true })
    } else {
      await $fetch(`/api/marketing/multi/${id.value}`, { method: 'PUT', body })
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
    await $fetch(`/api/marketing/multi/${id.value}/schedule`, { method: 'POST', body: { scheduled_at: at } })
    toast.add({ title: at ? 'Scheduled' : 'Sending — results appear here as it goes out', color: 'success' })
    await loadParent()
  } catch (err) {
    toast.add({ title: 'Could not send', description: marketingErrorMessage(err), color: 'error' })
  } finally {
    sending.value = false
  }
}

async function act(action: 'pause' | 'resume' | 'cancel') {
  acting.value = true
  try {
    await $fetch(`/api/marketing/multi/${id.value}/action`, { method: 'POST', body: { action } })
    await loadParent()
  } catch (err) {
    toast.add({ title: 'That didn\'t work', description: marketingErrorMessage(err), color: 'error' })
  } finally {
    acting.value = false
  }
}

async function remove() {
  try {
    await $fetch(`/api/marketing/multi/${id.value}`, { method: 'DELETE' })
    await navigateTo('/marketing/multi')
  } catch (err) {
    toast.add({ title: 'Could not delete', description: marketingErrorMessage(err), color: 'error' })
  }
}

const translateHeaders = computed(() => {
  const slug = sites.value.find(s => s.id === previewSite.value)?.slug
  return slug ? { 'x-active-org': slug } : {}
})

function body(lang: string) {
  return { org_id: previewSite.value, versions: draft.value.versions, source_language: draft.value.source_language, lang }
}
const previewFn = (lang: string) => $fetch<{ subject: string, html: string, lang: string }>('/api/marketing/multi/preview', { method: 'POST', body: body(lang) })
const testFn = async (lang: string) => (await $fetch<{ to: string }>('/api/marketing/multi/test', { method: 'POST', body: body(lang) })).to
</script>

<template>
  <div class="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
    <div class="flex flex-wrap items-center gap-3">
      <UButton
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        to="/marketing/multi"
        aria-label="Back"
      />
      <h1 class="text-2xl font-semibold flex-1 truncate">
        {{ draft.versions[draft.source_language]?.subject || 'Send to several sites' }}
      </h1>
      <UBadge
        v-if="parent"
        :label="MARKETING_STATUS[parent.status]?.label ?? parent.status"
        :color="MARKETING_STATUS[parent.status]?.color ?? 'neutral'"
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

    <template v-if="parent && !isDraft">
      <p class="text-sm text-(--ui-text-muted)">
        <span v-if="parent.status === 'scheduled'">Goes out {{ marketingDate(parent.scheduled_at) }}.</span>
        <span v-else-if="parent.started_at">Started {{ marketingDate(parent.started_at) }}<span v-if="parent.finished_at">, finished {{ marketingDate(parent.finished_at) }}</span>.</span>
      </p>
      <MarketingStats :stats="parent" />
      <div class="rounded-lg border border-(--ui-border) divide-y divide-(--ui-border)">
        <div
          v-for="p in parts"
          :key="p.id"
          class="flex flex-wrap items-center gap-3 p-3"
        >
          <div class="min-w-0 flex-1">
            <p class="font-medium">
              {{ p.name }}
            </p>
            <p
              v-if="p.email?.paused_reason"
              class="text-xs text-(--ui-warning)"
            >
              {{ MARKETING_PAUSE_REASONS[p.email.paused_reason] }}
            </p>
          </div>
          <span
            v-if="p.email"
            class="text-sm tabular-nums text-(--ui-text-muted)"
          >{{ p.email.sent.toLocaleString() }} sent · {{ p.email.skipped.toLocaleString() }} skipped · {{ p.email.unsubscribes.toLocaleString() }} unsubscribed</span>
          <UBadge
            v-if="p.email"
            :label="MARKETING_STATUS[p.email.status]?.label ?? p.email.status"
            :color="MARKETING_STATUS[p.email.status]?.color ?? 'neutral'"
            variant="subtle"
          />
          <span
            v-else
            class="text-xs text-(--ui-text-muted)"
          >You're no longer on this site's team</span>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton
          v-if="parent.status === 'sending'"
          label="Pause"
          icon="i-lucide-pause"
          color="neutral"
          variant="outline"
          :loading="acting"
          @click="act('pause')"
        />
        <UButton
          v-if="parent.status === 'paused'"
          label="Resume"
          icon="i-lucide-play"
          :loading="acting"
          @click="act('resume')"
        />
        <UButton
          v-if="['scheduled', 'sending', 'paused'].includes(parent.status)"
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

    <template v-if="sites.length || !isDraft">
      <div
        v-if="isDraft"
        class="space-y-2"
      >
        <h2 class="text-lg font-semibold">
          Sites
        </h2>
        <p class="text-sm text-(--ui-text-muted)">
          Each site sends with its own name, branding and unsubscribe link.
        </p>
        <div class="grid sm:grid-cols-2 gap-2">
          <div
            v-for="s in sites"
            :key="s.id"
            class="rounded-lg border border-(--ui-border) p-3"
          >
            <UCheckbox
              :model-value="orgIds.includes(s.id)"
              :label="s.name"
              :description="`${s.slug} · ${s.languages.join(', ')}`"
              @update:model-value="v => toggle('sites', s.id, v)"
            />
          </div>
        </div>
      </div>

      <UFormField
        v-if="siteItems.length > 1"
        label="Preview and test as"
        class="w-72"
      >
        <USelect
          v-model="previewSite"
          :items="siteItems"
          placeholder="Choose a site"
          class="w-full"
        />
      </UFormField>

      <MarketingComposer
        v-if="languages.length"
        v-model="draft"
        :languages="languages"
        :variables="variables"
        :preview="previewFn"
        :send-test="testFn"
        :translate-headers="translateHeaders"
        :disabled="!isDraft"
      />

      <template v-if="isDraft">
        <div
          v-if="audienceKeys.length"
          class="space-y-3"
        >
          <h2 class="text-lg font-semibold">
            Who gets it
          </h2>
          <p class="text-sm text-(--ui-text-muted)">
            Only people who opted in on a site get that site's email. Someone on several chosen sites gets one email, from the site they joined most recently where they opted in.
          </p>
          <div class="grid sm:grid-cols-2 gap-2">
            <div
              v-for="a in audienceKeys"
              :key="a.key"
              class="rounded-lg border border-(--ui-border) p-3"
            >
              <UCheckbox
                :model-value="draft.audiences.includes(a.key)"
                :label="a.label"
                :description="a.perSite.map(p => `${p.name}: ${p.count.toLocaleString()}`).join(' · ')"
                @update:model-value="v => toggle('audiences', a.key, v)"
              />
            </div>
          </div>
          <p
            v-if="draft.audiences.length"
            class="text-sm font-medium"
          >
            {{ people.toLocaleString() }} {{ people === 1 ? 'person' : 'people' }} will get one email each.
          </p>
        </div>

        <div class="space-y-3 border-t border-(--ui-border) pt-4">
          <div class="flex flex-wrap gap-2">
            <UButton
              label="Save draft"
              icon="i-lucide-save"
              color="neutral"
              variant="outline"
              :loading="saving"
              :disabled="!orgIds.length"
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
          </div>
          <MarketingSchedule
            :loading="sending"
            :problems="problems"
            :targets="audienceSites.map(s => ({ name: s.site.name, count: s.combined }))"
            :people="people"
            @send="send"
          />
        </div>
      </template>
    </template>
    <UEmpty
      v-else-if="!error"
      icon="i-lucide-send"
      title="No sites to send from"
      description="You need permission to send site email on at least one site."
    />
  </div>
</template>
