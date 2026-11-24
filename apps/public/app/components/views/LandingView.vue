<script setup lang="ts">
import type { CustomSectionView, PageView } from '~~/shared/view'
import { daysBetween } from '@prayertools/shared/dates'
import { entryUnit } from '~/utils/commitment'

const props = defineProps<{ page: Extract<PageView, { kind: 'landing' }> }>()
const { site, link, campaignLink, st, num, date, dateRange, aboutTitle, moreAboutLabel } = useSite()
const { t } = useI18n()
const campaign = computed(() => site.value.campaign)

// The sections after the hero, in page order. Neighbouring sections share a
// narrow column; the signup form is a full-width band between columns.
// Neighbouring short calls to action are gathered into one entry and shown as cards side by side.
interface Entry { key: string, customId?: string, custom?: CustomSectionView, placeholder: boolean, cards?: Entry[] }
const CUSTOM = 'custom:'
const CARD_SECTIONS = new Set(['share', 'contact', 'app'])
const HOW_STEPS = [
  { key: 'step1', icon: 'i-lucide-pen-line' },
  { key: 'step2', icon: 'i-lucide-bell-ring' },
  { key: 'step3', icon: 'i-lucide-clock' },
  { key: 'step4', icon: 'i-lucide-heart' }
]
const blocks = computed(() => {
  const out: { signup: boolean, entries: Entry[] }[] = []
  for (const key of props.page.sections) {
    if (key === 'signup') {
      out.push({ signup: true, entries: [] })
      continue
    }
    const placeholder = !!props.page.placeholders?.includes(key)
    const customId = key.startsWith(CUSTOM) ? key.slice(CUSTOM.length) : undefined
    const custom = props.page.custom.find(c => c.id === customId)
    if (!placeholder && (customId !== undefined ? !custom : key === 'today' && !props.page.today)) continue
    const entry: Entry = { key, customId, custom, placeholder }
    let column = out.at(-1)
    if (!column || column.signup) {
      column = { signup: false, entries: [] }
      out.push(column)
    }
    const prev = column.entries.at(-1)
    if (!CARD_SECTIONS.has(key) || placeholder) column.entries.push(entry)
    else if (prev?.cards) prev.cards.push(entry)
    else column.entries.push({ key: `cards:${key}`, placeholder: false, cards: [entry] })
  }
  return out
})

useHead({ title: () => campaign.value?.side ? `${campaign.value.name} · ${site.value.name}` : site.value.name })

const signupIntro = computed(() => campaign.value?.state === 'upcoming' && campaign.value.startDate
  ? t('signup.starts_on', { date: date(campaign.value.startDate) })
  : st('landing.signup.intro', { site: site.value.name }))

// Where a campaign with a start date stands: how soon it starts, or while it
// runs "Day 8 of 10" and "3 days left" (today counts as left).
const when = computed(() => {
  const c = campaign.value
  const run = props.page.run
  if (!c || !run) return null
  const dates = run.end ? dateRange(run.start, run.end) : c.state === 'upcoming' ? date(run.start) : t('landing.goal.since', { date: date(run.start) })
  if (c.state === 'upcoming') {
    const n = daysBetween(run.today, run.start)
    return { headline: t('landing.goal.starts_in', { n: num(n) }, n), detail: null, dates }
  }
  const unit = entryUnit(c.cadence)
  if (!c.length) return { headline: t(`pray.${unit}`, { n: num(c.todayEntry) }), detail: null, dates }
  const left = c.length - c.todayEntry + 1
  return {
    headline: t(`pray.${unit}_of`, { n: num(c.todayEntry), total: num(c.length) }),
    detail: left <= 1 ? t(`landing.last_${unit}`) : t(`landing.${unit}s_left`, { n: num(left) }, left),
    dates
  }
})
// The latest entry, when it isn't today's, is headed "Latest prayer" unless the site renamed the section.
const todayTitle = computed(() => props.page.today?.current === false && !site.value.strings['landing.today.title'] ? t('landing.today.latest') : st('landing.today.title'))
const todayLink = computed(() => props.page.today && !props.page.today.current ? link('pray', [props.page.today.day]) : link('pray'))
// On ongoing campaigns, everyone who has signed up since the start, when more than are committed now.
const signedUpLine = computed(() => {
  const n = props.page.signedUp
  const start = props.page.run?.start
  if (n === null || !start || !site.value.settings.showPeopleCount || n <= (props.page.progress?.people ?? 0)) return null
  const since = new Intl.DateTimeFormat(site.value.lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${start}T00:00:00Z`))
  return t('landing.goal.signed_up_since', { n: num(n), date: since }, n)
})
const showProgress = computed(() => !!props.page.progress && (props.page.progress.goal !== 'people' || site.value.settings.showPeopleCount))


const sharePrompt = ref(false)
const joined = ref(false)
const needsVerify = ref(false)
const verifyPrompt = ref(false)
const formKey = ref(0)
const signupEmail = useState<string | null>('pt-signup-email', () => null)

// Visitors already praying in the campaign shown get their prayer times instead of the signup form.
const subscribed = ref(false)
onMounted(async () => {
  const me = await fetchMe()
  subscribed.value = !!campaign.value && !!me?.campaigns.includes(campaign.value.id)
})

function onJoined(verify: boolean) {
  joined.value = true
  needsVerify.value = verify
  formKey.value++
  document.getElementById('signup')?.scrollIntoView({ behavior: 'smooth' })
  if (verify) verifyPrompt.value = true
  else if (site.value.settings.sharePrompts) setTimeout(() => (sharePrompt.value = true), 1200)
}
</script>

<template>
  <div>
    <CampaignHero title-id="top-title">
      <div class="space-y-5">
        <!-- The header already shows the site name, so the hero is titled with the campaign's. -->
        <h1 id="top-title" class="text-3xl sm:text-5xl font-bold leading-tight">{{ campaign?.name ?? site.name }}</h1>
        <p v-if="page.subtitle" class="text-xl sm:text-2xl font-semibold text-balance">{{ page.subtitle }}</p>
        <div class="flex flex-wrap justify-center gap-3">
          <UButton v-if="subscribed" :to="link('manage')" size="xl" class="pt-cta px-7" :label="t('landing.manage_times')" />
          <UButton v-else to="#signup" size="xl" class="pt-cta px-7" :label="st('landing.signup.title')" />
          <UButton v-if="page.today" :to="todayLink" size="xl" variant="outline" class="rounded-full px-7 font-semibold text-(--brand-text) ring-(--brand-text)/60 hover:bg-white/10" :label="page.today.current ? t('landing.pray_today') : t('landing.read_latest')" />
        </div>
        <NuxtLink :to="link('about')" class="inline-flex items-center gap-1.5 font-medium underline underline-offset-4 decoration-current/40 hover:decoration-current">
          {{ moreAboutLabel(page.template) }}<UIcon name="i-lucide-arrow-right" class="size-4 rtl:rotate-180" />
        </NuxtLink>
      </div>
    </CampaignHero>

    <div v-if="page.side.length" class="max-w-3xl mx-auto px-4 pt-10 space-y-3" :class="{ 'pb-10': blocks[0]?.signup }">
      <NuxtLink v-for="c in page.side" :key="c.slug" :to="campaignLink(c.slug)" class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-stone-200 bg-white px-5 py-4 shadow-[0_1px_3px_rgb(28_25_23/0.05)] transition-colors hover:border-primary/60">
        <div class="min-w-0 flex-1 space-y-1">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p class="text-lg font-semibold tracking-tight">{{ c.name }}</p>
            <UBadge :color="c.state === 'active' ? 'primary' : 'neutral'" variant="soft" size="sm" :label="c.state === 'active' ? t('landing.side.now') : t('landing.side.soon')" />
          </div>
          <p v-if="c.startDate && c.endDate" class="text-sm text-stone-600">{{ t('landing.side.dates', { start: date(c.startDate), end: date(c.endDate) }) }}</p>
        </div>
        <span class="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary">{{ t('landing.side.open') }}<UIcon name="i-lucide-arrow-right" class="size-4 rtl:rotate-180" /></span>
      </NuxtLink>
    </div>

    <template v-for="block in blocks" :key="block.signup ? 'signup' : block.entries[0]!.key">
      <section v-if="block.signup" id="signup" class="scroll-mt-4 bg-stone-100/70" aria-labelledby="signup-title" data-pt-section="signup">
        <div class="max-w-5xl mx-auto px-4 py-12">
          <div class="rounded-xl border border-stone-200 bg-white shadow-sm">
            <div v-if="subscribed && !joined" class="px-5 py-8 text-center sm:px-8 space-y-4">
              <h2 id="signup-title" class="text-2xl font-bold">{{ t('manage.title') }}</h2>
              <p class="text-stone-600">{{ t('landing.signed_up', { site: site.name }) }}</p>
              <UButton :to="link('manage')" size="lg" :label="t('landing.manage_times')" trailing-icon="i-lucide-arrow-right" />
            </div>
            <template v-else>
              <div class="border-b border-stone-200 px-5 py-6 text-center sm:px-8">
                <h2 id="signup-title" class="text-2xl font-bold">{{ st('landing.signup.title') }}</h2>
                <p class="mt-2 text-stone-600">{{ signupIntro }}</p>
              </div>
              <div class="px-5 py-6 sm:px-8 space-y-6">
                <UAlert v-if="joined && needsVerify" color="warning" variant="soft" icon="i-lucide-mail" :title="t('pray.check_email_title')" :description="t('pray.check_email_body_not_started')" role="status" />
                <UAlert v-else-if="joined" color="success" variant="soft" icon="i-lucide-check" :title="st('signup.success')" role="status" />
                <UAlert v-if="!page.form.open || !campaign" color="neutral" variant="soft" icon="i-lucide-info" :title="t('signup.closed')" />
                <LazySignupForm v-else :key="formKey" :form="page.form" hydrate-on-visible @joined="onJoined" />
              </div>
            </template>
          </div>
        </div>
      </section>

      <div v-else class="max-w-3xl mx-auto px-4 py-10 space-y-14">
        <template v-for="s in block.entries" :key="s.key">
          <div v-if="s.cards" class="grid gap-6 sm:grid-cols-2">
            <template v-for="(c, i) in s.cards" :key="c.key">
              <InviteCard v-if="c.key === 'share'" data-pt-section="share" centered :class="s.cards.length % 2 && i === s.cards.length - 1 && 'sm:col-span-2'" />
              <SectionCard v-else-if="c.key === 'contact'" :title="st('landing.contact.title')" title-id="contact-title" data-pt-section="contact" centered :class="s.cards.length % 2 && i === s.cards.length - 1 && 'sm:col-span-2'">
                <div class="space-y-4 py-5">
                  <p class="text-stone-700">{{ st('landing.contact.body') }}</p>
                  <UButton :to="link('contact')" variant="outline" color="neutral" icon="i-lucide-mail" :label="t('contact.button')" />
                </div>
              </SectionCard>
              <SectionCard v-else :title="st('landing.app.title')" title-id="app-title" data-pt-section="app" centered :class="s.cards.length % 2 && i === s.cards.length - 1 && 'sm:col-span-2'">
                <div class="py-5">
                  <AppLinks centered />
                </div>
              </SectionCard>
            </template>
          </div>
          <EditorPlaceholder v-else-if="s.placeholder && s.customId !== undefined" section="custom" :custom-id="s.customId" title="New section" />
          <EditorPlaceholder v-else-if="s.placeholder" :section="s.key" :title="st(`landing.${s.key}.title`)" />

          <section v-else-if="s.key === 'goal'" aria-labelledby="goal-title" data-pt-section="goal">
            <LandingHeading :title="st('landing.goal.title')" title-id="goal-title" />
            <div class="rounded-xl border border-stone-200 bg-white px-5 py-6 text-center shadow-[0_1px_3px_rgb(28_25_23/0.05)] sm:px-8 sm:py-8">
              <div v-if="when || showProgress || page.prayingNow > 0" class="grid gap-6 sm:grid-cols-2">
                <div v-if="when" class="space-y-1">
                  <p class="text-3xl font-bold tabular-nums">{{ when.headline }}</p>
                  <p v-if="when.detail" class="text-lg font-medium tabular-nums">{{ when.detail }}</p>
                  <p class="text-stone-600">{{ when.dates }}</p>
                </div>
                <div v-if="showProgress || page.prayingNow > 0" class="space-y-3">
                  <GoalProgress v-if="showProgress" :progress="page.progress!" />
                  <p v-if="signedUpLine" class="text-sm text-stone-600">{{ signedUpLine }}</p>
                  <p v-if="page.prayingNow > 0" class="inline-flex items-center gap-2 text-sm tabular-nums text-stone-700">
                    <span class="size-2 shrink-0 rounded-full bg-success" aria-hidden="true" />{{ t('pray.praying_now', { n: num(page.prayingNow) }, page.prayingNow) }}
                  </p>
                </div>
              </div>
              <div v-if="page.run?.calendar" :class="(when || showProgress || page.prayingNow > 0) && 'mt-8 border-t border-stone-200 pt-6'">
                <GoalCalendar :calendar="page.run.calendar" :today="page.run.today" />
              </div>
            </div>
          </section>

          <section v-else-if="s.key === 'why'" aria-labelledby="why-title" class="text-center" data-pt-section="why">
            <LandingHeading :title="st('landing.why.title')" title-id="why-title" />
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div class="pt-content pt-centered mx-auto max-w-prose" v-html="page.why" />
          </section>

          <section v-else-if="s.key === 'about'" aria-labelledby="about-title" class="text-center" data-pt-section="about">
            <LandingHeading :title="aboutTitle(page.template)" title-id="about-title" />
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div class="pt-content pt-centered mx-auto max-w-prose" v-html="page.about" />
          </section>

          <section v-else-if="s.custom" :aria-labelledby="`custom-${s.custom.id}`" :data-pt-custom="s.custom.id" class="space-y-4 text-center">
            <LandingHeading :title="s.custom.heading" :title-id="`custom-${s.custom.id}`" />
            <img v-if="s.custom.imageUrl" :src="s.custom.imageUrl" :alt="s.custom.imageAlt" class="w-full rounded-xl" loading="lazy">
            <video v-if="s.custom.video?.kind === 'file'" :src="s.custom.video.src" controls playsinline preload="metadata" class="w-full rounded-xl bg-black aspect-video" />
            <div v-else-if="s.custom.video" class="relative w-full aspect-video overflow-hidden rounded-xl bg-black">
              <iframe :src="s.custom.video.src" :title="s.custom.heading" loading="lazy" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" class="absolute inset-0 size-full border-0" />
            </div>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div class="pt-content pt-centered mx-auto max-w-prose" v-html="s.custom.html" />
            <UButton v-if="s.custom.buttonUrl && s.custom.buttonLabel" :to="s.custom.buttonUrl" target="_blank" :label="s.custom.buttonLabel" trailing-icon="i-lucide-external-link" />
          </section>

          <section v-else-if="s.key === 'stories'" aria-labelledby="stories-title" class="text-center" data-pt-section="stories">
            <LandingHeading :title="st('landing.stories.title')" title-id="stories-title" />
            <div class="flex flex-wrap justify-center gap-4">
              <figure v-for="story in page.stories" :key="story.id" class="m-0 w-full rounded-xl border border-stone-200 bg-white p-5 shadow-[0_1px_3px_rgb(28_25_23/0.05)] sm:w-[calc(50%-0.5rem)]">
                <blockquote class="whitespace-pre-line text-stone-800">{{ story.body }}</blockquote>
                <figcaption class="mt-3 text-sm text-stone-600">— {{ story.name || t('stories.anonymous') }}</figcaption>
              </figure>
            </div>
            <NuxtLink :to="link('stories')" class="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline">
              <UIcon name="i-lucide-pen-line" class="size-4 shrink-0" />{{ t('stories.share_link') }}
            </NuxtLink>
          </section>

          <section v-else-if="s.key === 'how'" aria-labelledby="how-title" class="text-center" data-pt-section="how">
            <LandingHeading :title="st('landing.how.title')" title-id="how-title" />
            <ol class="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4">
              <li v-for="step in HOW_STEPS" :key="step.key" class="flex flex-col items-center gap-3">
                <span class="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
                  <UIcon :name="step.icon" class="size-7" />
                </span>
                <span class="font-semibold text-balance">{{ st(`landing.how.${step.key}`, { site: site.name }) }}</span>
              </li>
            </ol>
          </section>

          <section v-else-if="s.key === 'today' && page.today" aria-labelledby="today-title" data-pt-section="today">
            <LandingHeading :title="todayTitle" title-id="today-title" :subtitle="page.today.current || !page.today.date ? t(`pray.${entryUnit(campaign?.cadence)}`, { n: num(page.today.day) }) : date(page.today.date)" />
            <div class="rounded-xl border border-stone-200 bg-white shadow-[0_1px_3px_rgb(28_25_23/0.05)]">
              <div class="max-h-96 overflow-hidden px-5 pt-6 pb-6 sm:px-8 sm:pt-8 [mask-image:linear-gradient(to_bottom,#000_calc(100%_-_4rem),transparent)]">
                <!-- eslint-disable-next-line vue/no-v-html -->
                <div class="pt-content pt-flush" v-html="page.today.html" />
              </div>
              <div class="flex justify-center border-t border-stone-200 px-5 py-5 sm:px-8">
                <UButton :to="todayLink" size="lg" :label="t('landing.continue_praying')" trailing-icon="i-lucide-arrow-right" :ui="{ trailingIcon: 'rtl:rotate-180' }" class="w-full justify-center sm:w-auto" />
              </div>
            </div>
          </section>
        </template>
      </div>
    </template>

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
  </div>
</template>
