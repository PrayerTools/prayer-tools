<script setup lang="ts">
import type { PageView } from '~~/shared/view'
import { entryUnit } from '~/utils/commitment'

const props = defineProps<{ page: Extract<PageView, { kind: 'pray' }> }>()
const { site, link, st, num } = useSite()
const { t } = useI18n()
const route = useRoute()

const unit = computed(() => entryUnit(site.value.campaign?.cadence))
const entryTitle = computed(() => props.page.personal && props.page.length
  ? t(`pray.${unit.value}_of`, { n: num(props.page.day), total: num(props.page.length) })
  : t(`pray.${unit.value}`, { n: num(props.page.day) }))
const opensNext = { day: 'pray.opens_tomorrow', week: 'pray.opens_next_week', month: 'pray.opens_next_month' }
const prevLabel = { day: 'pray.previous', week: 'pray.previous_week', month: 'pray.previous_month' }
const nextLabel = { day: 'pray.next', week: 'pray.next_week', month: 'pray.next_month' }

useHead({ title: () => `${entryTitle.value} · ${site.value.name}` })

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

// The viewer's own calendar date, known once the page runs in the browser.
const localToday = ref<string | null>(null)
onMounted(() => {
  const d = new Date()
  localToday.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})
const showNext = computed(() => !!props.page.next && (!props.page.nextDate || (!!localToday.value && localToday.value >= props.page.nextDate)))

// Personal-start campaigns: where a recognised subscriber is (see
// /api/pray/position). Null for visitors we don't recognise.
interface Position { current: number, movedToday: boolean, entries: number | null, finished: boolean }
const position = ref<Position | null>(null)
const positionChecked = ref(false)
const nextOpensLater = computed(() => {
  const p = position.value
  return !!p && p.movedToday && !p.finished && props.page.day === p.current - 1
})
const showPersonalSignup = computed(() => props.page.personal && positionChecked.value && !position.value)
const showReminders = computed(() => !joined.value && !props.page.personal)

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
      body: { id: sessionId.value, visitor: visitorId(), campaign: site.value.campaign.id, day: props.page.day, language: site.value.lang, source: personal ? 'manage' : 'porch', p: personal }
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
  <article>
    <div class="border-b border-stone-200 bg-white">
      <div class="max-w-3xl mx-auto px-4 py-8 sm:py-10 space-y-5">
        <UAlert v-if="joined && needsVerify" color="warning" variant="soft" icon="i-lucide-mail" :title="t('pray.check_email_title')" :description="t('pray.check_email_body')" role="status" />
        <UAlert v-else-if="joined" color="success" variant="soft" icon="i-lucide-check" :title="st('signup.success')" role="status" />
        <UAlert v-if="confirmed" color="success" variant="soft" icon="i-lucide-badge-check" :title="t('pray.confirmed_title')" :description="t('pray.confirmed_body')" role="status" />
        <div class="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <header class="min-w-0 space-y-2">
            <h1 class="text-3xl sm:text-4xl font-bold tracking-tight text-balance">{{ entryTitle }}</h1>
            <p v-if="page.dateLabel" class="text-stone-600">{{ page.dateLabel }}</p>
            <UProgress v-if="position?.entries" :model-value="Math.min(position.current - 1, position.entries)" :max="position.entries" size="sm" class="w-56 max-w-full pt-1" />
          </header>
          <nav v-if="page.prev || showNext || nextOpensLater" class="flex flex-wrap items-center gap-x-4 gap-y-2" :aria-label="t('pray.nav')">
            <UButton v-if="page.prev" :to="link('pray', [page.prev])" variant="outline" color="neutral" icon="i-lucide-arrow-left" :ui="{ leadingIcon: 'rtl:rotate-180' }" :label="t(prevLabel[unit])" />
            <UButton v-if="showNext" :to="link('pray', [page.next!])" variant="outline" color="neutral" trailing-icon="i-lucide-arrow-right" :ui="{ trailingIcon: 'rtl:rotate-180' }" :label="t(nextLabel[unit])" />
            <p v-else-if="nextOpensLater" class="inline-flex items-center gap-1.5 text-sm text-stone-600" role="status">
              <UIcon name="i-lucide-clock" class="size-4 shrink-0" />{{ t(opensNext[unit], { n: num(position!.current) }) }}
            </p>
          </nav>
        </div>
        <div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <NuxtLink v-if="site.campaign" :to="link()" class="inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline">
            <UIcon name="i-lucide-house" class="size-4 shrink-0" />{{ site.campaign.name }} · {{ t('manage.home_link') }}
          </NuxtLink>
          <p v-if="prayingNow > 0 && site.settings.showPrayingNow" class="inline-flex items-center gap-2 text-stone-600 tabular-nums" aria-live="polite">
            <span class="size-2 shrink-0 rounded-full bg-success" aria-hidden="true" />{{ t('pray.praying_now', { n: num(prayingNow) }, prayingNow) }}
          </p>
        </div>
      </div>
    </div>

    <div class="max-w-3xl mx-auto px-4 py-8 sm:py-10 space-y-6">
      <div class="rounded-xl border border-stone-200 bg-white shadow-[0_1px_3px_rgb(28_25_23/0.05)]">
        <p v-if="!page.blocks.length" class="px-5 py-6 sm:px-8 text-stone-700">{{ t('pray.no_content') }}</p>
        <section v-for="(b, i) in page.blocks" :key="i" :aria-labelledby="page.blocks.length > 1 ? `block-${i}` : undefined" :class="i > 0 && 'border-t border-stone-200'">
          <header v-if="page.blocks.length > 1" class="flex min-h-14 items-center border-b border-stone-200 px-5 py-3 sm:px-8">
            <h2 :id="`block-${i}`" class="text-base font-semibold tracking-tight">{{ b.title }}</h2>
          </header>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="pt-content pt-flush px-5 py-6 sm:px-8 sm:py-8" v-html="b.html" />
        </section>
        <footer class="flex flex-col items-center gap-2 border-t border-stone-200 px-5 py-5 sm:px-8">
          <Transition mode="out-in" enter-active-class="transition duration-300 ease-out motion-reduce:transition-none" enter-from-class="opacity-0 scale-95">
            <UButton v-if="!amened" key="amen" size="xl" icon="i-lucide-heart-handshake" :label="t('pray.amen')" class="w-full justify-center sm:w-auto" @click="amen" />
            <div v-else key="thanks" class="flex flex-wrap items-center justify-center gap-x-6 gap-y-3" role="status">
              <p class="inline-flex items-center gap-3 font-semibold">
                <span class="grid size-10 shrink-0 place-items-center rounded-full bg-success/10 text-success"><UIcon name="i-lucide-heart" class="size-5" /></span>
                {{ t('pray.amen_thanks') }}
              </p>
              <UButton v-if="showNext" :to="link('pray', [page.next!])" variant="outline" color="neutral" trailing-icon="i-lucide-arrow-right" :ui="{ trailingIcon: 'rtl:rotate-180' }" :label="t(nextLabel[unit])" />
            </div>
          </Transition>
          <div class="flex flex-col items-center">
            <UButton variant="ghost" color="neutral" icon="i-lucide-users" :label="t('pray.group_question')" :aria-expanded="groupOpen" @click="groupOpen = !groupOpen" />
            <form v-if="groupOpen && !groupSent" class="mt-2" @submit.prevent="sendGroup">
              <UFormField :label="t('pray.group_count')" name="group-count">
                <div class="flex items-center gap-3">
                  <UInputNumber v-model="groupCount" :min="2" :max="10000" class="w-36" />
                  <UButton type="submit" variant="outline" :label="t('pray.group_submit')" />
                </div>
              </UFormField>
            </form>
            <p v-if="groupSent" class="text-sm text-stone-700 mt-2" role="status">{{ t('pray.group_thanks') }}</p>
          </div>
        </footer>
      </div>

      <aside class="grid gap-6 sm:grid-cols-2">
        <SectionCard v-if="showPersonalSignup" :title="t('pray.personal_signup_title')" title-id="personal-signup-title">
          <div class="space-y-3 py-5">
            <p class="text-stone-700">{{ t('pray.personal_signup_body') }}</p>
            <UButton :to="link('signup')" :label="t('pray.personal_signup')" />
            <p class="text-sm text-stone-600">{{ t('pray.personal_signed_up') }}</p>
          </div>
        </SectionCard>
        <SectionCard v-else-if="showReminders" :title="t('pray.get_reminders')" title-id="reminders-title">
          <div class="space-y-4 py-5">
            <p class="text-stone-700">{{ st('landing.signup.intro', { site: site.name }) }}</p>
            <UButton :to="link('signup')" variant="outline" icon="i-lucide-bell" :label="st(site.campaign?.goal === 'coverage' ? 'landing.signup.button' : 'landing.signup.title')" />
          </div>
        </SectionCard>
        <InviteCard :class="!showPersonalSignup && !showReminders && 'sm:col-span-2'" />
      </aside>
    </div>

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
