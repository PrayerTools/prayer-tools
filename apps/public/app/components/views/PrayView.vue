<script setup lang="ts">
import type { PageView } from '~~/shared/view'

const props = defineProps<{ page: Extract<PageView, { kind: 'pray' }> }>()
const { site, link, st, num } = useSite()
const { t } = useI18n()
const route = useRoute()

useHead({ title: () => `${t('pray.day', { n: props.page.day })} · ${site.value.name}` })

const joined = computed(() => route.query.joined === '1')
const needsVerify = computed(() => route.query.verify === '1')
const confirmed = computed(() => route.query.confirmed === '1')
const sharePrompt = ref(false)
const verifyPrompt = ref(false)
const signupEmail = useState<string | null>('pt-signup-email', () => null)
const prayingNow = ref(0)
const amened = ref(false)
const groupOpen = ref(false)
const groupCount = ref<number | null>(2)
const groupSent = ref(false)

// Personal-start campaigns: where a recognised subscriber is (see
// /api/pray/position). Null for visitors we don't recognise.
interface Position { current: number, movedToday: boolean, entries: number | null, finished: boolean }
const position = ref<Position | null>(null)
const positionChecked = ref(false)
const weekly = computed(() => site.value.campaign?.cadence === 'weekly')
const nextOpensLater = computed(() => {
  const p = position.value
  return !!p && p.movedToday && !p.finished && props.page.day === p.current - 1
})

// The entry `/pray` shows a recognised subscriber: the one they are on, or
// the one they already prayed today.
function entryFor(p: Position): number {
  if (p.finished) return Math.max(1, p.entries ?? 1)
  return Math.max(1, p.movedToday ? p.current - 1 : p.current)
}

async function lookupPosition(): Promise<Position | null> {
  try {
    const res = await $fetch<{ position: Position | null }>('/api/pray/position', { method: 'POST', body: { campaign: site.value.campaign!.id, p: personal } })
    return res.position
  } catch {
    return null
  }
}

const LICENSES: Record<string, string> = { cc_by: 'CC BY 4.0', cc_by_sa: 'CC BY-SA 4.0' }

function licenseLabel(l: string | null): string {
  if (!l || l === 'own') return ''
  return LICENSES[l] ?? t(`license.${l}`)
}

// Prayer session: a client id, pinged every 30 s while the page is visible.
// The personal token from a reminder link rides in the URL fragment, so the
// page itself stays shared and cacheable.
const sessionId = ref('')
let personal: string | null = null
let timer: ReturnType<typeof setInterval> | null = null

// Reloading or reopening a day within 3 hours continues the same session, so
// it counts as one prayer.
const SESSION_REUSE_MS = 3 * 3600_000
const SESSION_PREFIX = 'pt_session:'
interface StoredSession { id: string, at: number, amen?: boolean }

function sessionKey(): string {
  return `${SESSION_PREFIX}${site.value.orgId}:${site.value.campaign?.id}:${props.page.day}`
}

function storedSession(): StoredSession | null {
  try {
    const s = JSON.parse(localStorage.getItem(sessionKey()) ?? 'null') as StoredSession | null
    return s && typeof s.id === 'string' && Date.now() - s.at < SESSION_REUSE_MS ? s : null
  } catch {
    return null
  }
}

function saveSession(s: StoredSession) {
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(SESSION_PREFIX) || key === sessionKey()) continue
      const old = JSON.parse(localStorage.getItem(key) ?? 'null') as StoredSession | null
      if (!old || Date.now() - old.at >= SESSION_REUSE_MS) localStorage.removeItem(key)
    }
    localStorage.setItem(sessionKey(), JSON.stringify(s))
  } catch {
    // storage blocked
  }
}

async function ping() {
  if (document.visibilityState === 'hidden' || amened.value || !site.value.campaign) return
  try {
    const res = await $fetch<{ praying_now: number, position: Position | null }>('/api/pray/ping', {
      method: 'POST',
      body: { id: sessionId.value, campaign: site.value.campaign.id, day: props.page.day, language: site.value.lang, source: personal ? 'manage' : 'porch', p: personal }
    })
    prayingNow.value = res.praying_now
    if (res.position) position.value = res.position
  } catch {
    // non-critical
  }
}

onMounted(async () => {
  const hash = new URLSearchParams(location.hash.slice(1))
  personal = hash.get('p')
  if (personal) {
    try {
      sessionStorage.setItem('pt_p', personal)
    } catch {
      // storage blocked
    }
    history.replaceState(history.state, '', location.pathname + location.search)
  } else {
    try {
      personal = sessionStorage.getItem('pt_p')
    } catch {
      personal = null
    }
  }
  if (props.page.personal && site.value.campaign) {
    position.value = await lookupPosition()
    positionChecked.value = true
    const target = position.value && !props.page.chosen ? entryFor(position.value) : null
    if (target && target !== props.page.day) {
      await navigateTo({ path: link('pray', [target]), query: route.query }, { replace: true })
      return
    }
  }
  const stored = storedSession()
  sessionId.value = stored?.id ?? crypto.randomUUID()
  amened.value = !!stored?.amen
  if (!stored) saveSession({ id: sessionId.value, at: Date.now() })
  void ping()
  timer = setInterval(ping, 30_000)
  document.addEventListener('visibilitychange', onVisible)
  if (joined.value && needsVerify.value) verifyPrompt.value = true
  else if ((joined.value || confirmed.value) && site.value.settings.sharePrompts) setTimeout(() => (sharePrompt.value = true), 1200)
  dropQueryParams('confirmed', 'joined', 'verify')
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  document.removeEventListener('visibilitychange', onVisible)
})

function onVisible() {
  if (document.visibilityState === 'visible') void ping()
}

async function amen() {
  amened.value = true
  saveSession({ ...(storedSession() ?? { id: sessionId.value, at: Date.now() }), amen: true })
  try {
    await $fetch('/api/pray/amen', { method: 'POST', body: { id: sessionId.value } })
  } catch {
    // non-critical
  }
  let count = 0
  try {
    const key = `pt_amen:${site.value.orgId}`
    count = Number(localStorage.getItem(key) ?? 0) + 1
    localStorage.setItem(key, String(count))
  } catch {
    // storage blocked
  }
  if ((count === 3 || count === 7) && site.value.settings.sharePrompts) sharePrompt.value = true
}

async function sendGroup() {
  const n = Math.round(Number(groupCount.value))
  if (!n || n < 2) return
  try {
    await $fetch('/api/pray/group', { method: 'POST', body: { id: sessionId.value, campaign: site.value.campaign?.id, day: props.page.day, count: n } })
    groupSent.value = true
  } catch {
    // non-critical
  }
}
</script>

<template>
  <article class="max-w-3xl mx-auto px-4 py-8 space-y-6">
    <UAlert v-if="joined && needsVerify" color="warning" variant="soft" icon="i-lucide-mail" :title="t('pray.check_email_title')" :description="t('pray.check_email_body')" role="status" />
    <UAlert v-else-if="joined" color="success" variant="soft" icon="i-lucide-check" :title="st('signup.success')" role="status" />
    <UAlert v-if="confirmed" color="success" variant="soft" icon="i-lucide-badge-check" :title="t('pray.confirmed_title')" :description="t('pray.confirmed_body')" role="status" />

    <header class="space-y-1">
      <p v-if="site.campaign" class="text-sm text-stone-600">{{ site.campaign.name }}</p>
      <h1 class="text-3xl font-bold">{{ page.personal && page.length ? t('pray.day_of', { n: num(page.day), total: num(page.length) }) : t('pray.day', { n: num(page.day) }) }}</h1>
      <UProgress v-if="position?.entries" :model-value="Math.min(position.current - 1, position.entries)" :max="position.entries" size="sm" class="max-w-xs" />
      <p v-if="page.dateLabel" class="text-stone-600">{{ page.dateLabel }}</p>
      <p v-if="prayingNow > 1 && site.settings.showPrayingNow" class="text-sm text-stone-700" aria-live="polite">
        {{ t('pray.praying_now', { n: num(prayingNow) }, prayingNow) }}
      </p>
    </header>

    <p v-if="!page.blocks.length" class="text-stone-700">{{ t('pray.no_content') }}</p>
    <section v-for="(b, i) in page.blocks" :key="i" class="space-y-3">
      <h2 v-if="page.blocks.length > 1" class="text-sm font-semibold uppercase tracking-wide text-stone-500">{{ b.title }}</h2>
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div class="pt-content" v-html="b.html" />
      <p v-if="b.credit || licenseLabel(b.license)" class="text-xs text-stone-500">
        {{ [b.credit ? t('pray.credit', { credit: b.credit }) : '', licenseLabel(b.license)].filter(Boolean).join(' · ') }}
      </p>
    </section>

    <div class="rounded-2xl bg-white border border-stone-200 p-5 space-y-4">
      <UButton v-if="!amened" size="xl" block icon="i-lucide-heart-handshake" :label="t('pray.amen')" @click="amen" />
      <UAlert v-else color="success" variant="soft" icon="i-lucide-heart" :title="t('pray.amen_thanks')" role="status" />
      <div>
        <UButton variant="link" color="neutral" icon="i-lucide-users" :label="t('pray.group_question')" :aria-expanded="groupOpen" @click="groupOpen = !groupOpen" />
        <form v-if="groupOpen && !groupSent" class="flex flex-wrap items-end gap-3 mt-2" @submit.prevent="sendGroup">
          <UFormField :label="t('pray.group_count')" name="group-count">
            <UInputNumber v-model="groupCount" :min="2" :max="10000" class="w-36" />
          </UFormField>
          <UButton type="submit" variant="outline" :label="t('pray.group_submit')" />
        </form>
        <p v-if="groupSent" class="text-sm text-stone-700 mt-2" role="status">{{ t('pray.group_thanks') }}</p>
      </div>
    </div>

    <p v-if="nextOpensLater" class="text-stone-700" role="status">{{ t(weekly ? 'pray.opens_next_week' : 'pray.opens_tomorrow', { n: num(position!.current) }) }}</p>
    <div v-if="page.personal && positionChecked && !position" class="rounded-2xl bg-white border border-stone-200 p-5 space-y-3">
      <h2 class="text-lg font-semibold">{{ t('pray.personal_signup_title') }}</h2>
      <p class="text-stone-700">{{ t('pray.personal_signup_body') }}</p>
      <UButton :to="link('signup')" :label="t('pray.personal_signup')" />
      <p class="text-sm text-stone-600">{{ t('pray.personal_signed_up') }}</p>
    </div>

    <nav class="flex justify-between gap-4" :aria-label="t('pray.nav')">
      <UButton v-if="page.prev" :to="link('pray', [page.prev])" variant="outline" icon="i-lucide-arrow-left" :label="t('pray.previous')" class="rtl:[&_svg]:rotate-180" />
      <span v-else />
      <UButton v-if="page.next" :to="link('pray', [page.next])" variant="outline" trailing-icon="i-lucide-arrow-right" :label="t('pray.next')" class="rtl:[&_svg]:rotate-180" />
    </nav>

    <section class="space-y-3 border-t border-stone-200 pt-6" aria-labelledby="pray-share">
      <h2 id="pray-share" class="text-lg font-semibold">{{ t('share.invite') }}</h2>
      <ShareButton size="md" variant="soft" />
      <p v-if="!joined" class="text-sm"><NuxtLink :to="link('signup')" class="underline">{{ t('pray.get_reminders') }}</NuxtLink></p>
    </section>

    <UModal v-model:open="verifyPrompt" :title="t('pray.verify_prompt_title')" :description="signupEmail ? t('pray.verify_prompt_body_email', { email: signupEmail }) : t('pray.verify_prompt_body')">
      <template #body>
        <div class="flex items-start gap-4">
          <UIcon name="i-lucide-mail-check" class="size-10 shrink-0 text-primary" />
          <p class="text-stone-700">{{ t('pray.verify_prompt_spam') }}</p>
        </div>
      </template>
      <template #footer>
        <UButton :label="t('pray.verify_prompt_ok')" @click="verifyPrompt = false" />
      </template>
    </UModal>
    <SharePrompt v-model:open="sharePrompt" :title="t('share.prompt_title')" :description="t('share.prompt_body')" />
  </article>
</template>
