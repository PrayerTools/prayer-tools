<script setup lang="ts">
import type { CustomSectionView, PageView } from '~~/shared/view'

const props = defineProps<{ page: Extract<PageView, { kind: 'landing' }> }>()
const { site, link, campaignLink, st, num, date } = useSite()
const { t } = useI18n()
const campaign = computed(() => site.value.campaign)

// The sections after the hero, in page order. Neighbouring sections share a
// narrow column; the signup form is a full-width band between columns.
// Neighbouring short calls to action are gathered into one entry and shown as cards side by side.
interface Entry { key: string, customId?: string, custom?: CustomSectionView, placeholder: boolean, cards?: Entry[] }
const CUSTOM = 'custom:'
const CARD_SECTIONS = new Set(['share', 'contact', 'app'])
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

const imageStyle = computed(() => site.value.image ? { objectPosition: `${site.value.image.fx * 100}% ${site.value.image.fy * 100}%` } : {})

// Splits the image credit so web addresses in it render as links.
const creditParts = computed(() => (site.value.image?.credit ?? '')
  .split(/(https?:\/\/[^\s<>"]*[^\s<>".,;:!?)])/)
  .filter(Boolean)
  .map(text => ({ text, url: /^https?:\/\//.test(text) })))

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
    <!-- pt-15 leaves room for the site header, which overlays the hero. -->
    <section class="brand-bg relative overflow-hidden pt-15" aria-labelledby="top-title" data-pt-section="top">
      <template v-if="site.image">
        <img :src="site.image.url" :alt="site.image.alt" class="absolute inset-0 size-full object-cover" :style="imageStyle" fetchpriority="high">
        <!-- Tints the image with the brand color so text keeps its contrast. -->
        <div class="absolute inset-0 bg-(--brand) opacity-80" aria-hidden="true" />
      </template>
      <div class="relative max-w-3xl mx-auto px-4 py-16 sm:py-28 text-center">
        <div class="space-y-5">
          <!-- The header already shows the site name, so the hero is titled with the campaign's. -->
          <h1 id="top-title" class="text-3xl sm:text-5xl font-bold leading-tight">{{ campaign?.name ?? site.name }}</h1>
          <p v-if="page.subtitle" class="text-lg opacity-95">{{ page.subtitle }}</p>
          <p v-if="campaign?.state === 'upcoming' && campaign.startDate" class="font-medium">{{ t('landing.starts_on', { date: date(campaign.startDate) }) }}</p>
          <GoalProgress v-if="page.progress" :progress="page.progress" on-brand />
          <p v-if="page.prayingNow > 0" class="inline-flex items-center gap-2 text-sm tabular-nums">
            <span class="size-2 shrink-0 rounded-full bg-current" aria-hidden="true" />{{ t('pray.praying_now', { n: num(page.prayingNow) }, page.prayingNow) }}
          </p>
          <div class="flex flex-wrap justify-center gap-3">
            <UButton v-if="subscribed" :to="link('manage')" size="xl" color="neutral" variant="solid" class="bg-white text-stone-900 hover:bg-stone-100" :label="t('landing.manage_times')" />
            <UButton v-else to="#signup" size="xl" color="neutral" variant="solid" class="bg-white text-stone-900 hover:bg-stone-100" :label="st('landing.signup.title')" />
            <UButton v-if="page.today" :to="link('pray')" size="xl" variant="outline" class="text-(--brand-text) ring-(--brand-text)/60 hover:bg-white/10" :label="t('landing.pray_today')" />
          </div>
        </div>
      </div>
      <UPopover v-if="site.image?.credit" :content="{ side: 'top', align: 'end' }">
        <UButton icon="i-lucide-info" size="sm" variant="ghost" color="neutral" class="absolute bottom-1 end-1 rounded-full text-(--brand-text) opacity-80 hover:opacity-100 hover:bg-white/10" :aria-label="t('landing.photo_credit')" />
        <template #content>
          <div class="max-w-xs p-3 text-xs space-y-1">
            <p class="font-medium">{{ t('landing.photo_credit') }}</p>
            <p>
              <template v-for="(part, i) in creditParts" :key="i">
                <a v-if="part.url" :href="part.text" target="_blank" rel="noopener noreferrer nofollow" class="underline underline-offset-2 break-all">{{ part.text }}</a>
                <template v-else>{{ part.text }}</template>
              </template>
            </p>
          </div>
        </template>
      </UPopover>
    </section>

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
              <SectionCard v-if="c.key === 'share'" :title="st('landing.share.title')" title-id="share-title" data-pt-section="share" :class="s.cards.length % 2 && i === s.cards.length - 1 && 'sm:col-span-2'">
                <div class="space-y-4 py-5">
                  <p class="text-stone-700">{{ st('landing.share.body') }}</p>
                  <ShareButton size="md" variant="soft" />
                </div>
              </SectionCard>
              <SectionCard v-else-if="c.key === 'contact'" :title="st('landing.contact.title')" title-id="contact-title" data-pt-section="contact" :class="s.cards.length % 2 && i === s.cards.length - 1 && 'sm:col-span-2'">
                <div class="space-y-4 py-5">
                  <p class="text-stone-700">{{ st('landing.contact.body') }}</p>
                  <UButton :to="link('contact')" variant="outline" color="neutral" icon="i-lucide-mail" :label="t('contact.button')" />
                </div>
              </SectionCard>
              <SectionCard v-else :title="st('landing.app.title')" title-id="app-title" data-pt-section="app" :class="s.cards.length % 2 && i === s.cards.length - 1 && 'sm:col-span-2'">
                <div class="py-5">
                  <AppLinks />
                </div>
              </SectionCard>
            </template>
          </div>
          <EditorPlaceholder v-else-if="s.placeholder && s.customId !== undefined" section="custom" :custom-id="s.customId" title="New section" />
          <EditorPlaceholder v-else-if="s.placeholder" :section="s.key" :title="st(`landing.${s.key}.title`)" />

          <section v-else-if="s.key === 'why'" aria-labelledby="why-title" data-pt-section="why">
            <h2 id="why-title" class="text-2xl font-bold mb-4">{{ st('landing.why.title') }}</h2>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div class="pt-content" v-html="page.why" />
          </section>

          <section v-else-if="s.custom" :aria-labelledby="`custom-${s.custom.id}`" :data-pt-custom="s.custom.id" class="space-y-4">
            <h2 :id="`custom-${s.custom.id}`" class="text-2xl font-bold">{{ s.custom.heading }}</h2>
            <img v-if="s.custom.imageUrl" :src="s.custom.imageUrl" :alt="s.custom.imageAlt" class="w-full rounded-xl" loading="lazy">
            <video v-if="s.custom.video?.kind === 'file'" :src="s.custom.video.src" controls playsinline preload="metadata" class="w-full rounded-xl bg-black aspect-video" />
            <div v-else-if="s.custom.video" class="relative w-full aspect-video overflow-hidden rounded-xl bg-black">
              <iframe :src="s.custom.video.src" :title="s.custom.heading" loading="lazy" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" class="absolute inset-0 size-full border-0" />
            </div>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div class="pt-content" v-html="s.custom.html" />
            <UButton v-if="s.custom.buttonUrl && s.custom.buttonLabel" :to="s.custom.buttonUrl" target="_blank" :label="s.custom.buttonLabel" trailing-icon="i-lucide-external-link" />
          </section>

          <section v-else-if="s.key === 'stories'" aria-labelledby="stories-title" data-pt-section="stories">
            <h2 id="stories-title" class="text-2xl font-bold mb-4">{{ st('landing.stories.title') }}</h2>
            <div class="grid gap-4 sm:grid-cols-2">
              <figure v-for="story in page.stories" :key="story.id" class="m-0 rounded-xl border border-stone-200 bg-white p-5 shadow-[0_1px_3px_rgb(28_25_23/0.05)]">
                <blockquote class="whitespace-pre-line text-stone-800">{{ story.body }}</blockquote>
                <figcaption class="mt-3 text-sm text-stone-600">— {{ story.name || t('stories.anonymous') }}</figcaption>
              </figure>
            </div>
            <NuxtLink :to="link('stories')" class="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline">
              <UIcon name="i-lucide-pen-line" class="size-4 shrink-0" />{{ t('stories.share_link') }}
            </NuxtLink>
          </section>

          <section v-else-if="s.key === 'how'" aria-labelledby="how-title" data-pt-section="how">
            <h2 id="how-title" class="text-2xl font-bold mb-4">{{ st('landing.how.title') }}</h2>
            <p class="whitespace-pre-line text-lg leading-[1.75] text-stone-800">{{ st('landing.how.body', { site: site.name }) }}</p>
          </section>

          <section v-else-if="s.key === 'today' && page.today" aria-labelledby="today-title" class="space-y-4" data-pt-section="today">
            <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id="today-title" class="text-2xl font-bold">{{ st('landing.today.title') }}</h2>
              <p class="text-sm text-stone-600">{{ t(campaign?.cadence === 'weekly' ? 'pray.week' : 'pray.day', { n: num(page.today.day) }) }}</p>
            </div>
            <div class="rounded-xl border border-stone-200 bg-white shadow-[0_1px_3px_rgb(28_25_23/0.05)]">
              <div class="max-h-96 overflow-hidden px-5 pt-6 pb-6 sm:px-8 sm:pt-8 [mask-image:linear-gradient(to_bottom,#000_calc(100%_-_4rem),transparent)]">
                <!-- eslint-disable-next-line vue/no-v-html -->
                <div class="pt-content pt-flush" v-html="page.today.html" />
              </div>
              <div class="flex justify-center border-t border-stone-200 px-5 py-5 sm:px-8">
                <UButton :to="link('pray')" size="lg" :label="t('landing.continue_praying')" trailing-icon="i-lucide-arrow-right" :ui="{ trailingIcon: 'rtl:rotate-180' }" class="w-full justify-center sm:w-auto" />
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
