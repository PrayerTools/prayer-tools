<script setup lang="ts">
import type { PageView } from '~~/shared/view'

const props = defineProps<{ page: Extract<PageView, { kind: 'landing' }> }>()
const { site, link, campaignLink, st, num, date } = useSite()
const { t } = useI18n()
const has = (s: string) => props.page.sections.includes(s)
const placeholder = (s: string) => props.page.placeholders?.includes(s)
const campaign = computed(() => site.value.campaign)

useHead({ title: () => campaign.value?.side ? `${campaign.value.name} · ${site.value.name}` : site.value.name })

const signupIntro = computed(() => campaign.value?.state === 'upcoming' && campaign.value.startDate
  ? t('signup.starts_on', { date: date(campaign.value.startDate) })
  : st('landing.signup.intro', { site: site.value.name }))

const imageStyle = computed(() => site.value.image ? { objectPosition: `${site.value.image.fx * 100}% ${site.value.image.fy * 100}%` } : {})

const sharePrompt = ref(false)
const joined = ref(false)
const needsVerify = ref(false)
const verifyPrompt = ref(false)
const formKey = ref(0)
const signupEmail = useState<string | null>('pt-signup-email', () => null)

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
    <section class="brand-bg relative overflow-hidden" aria-labelledby="top-title" data-pt-section="top">
      <template v-if="site.image">
        <img :src="site.image.url" :alt="site.image.alt" class="absolute inset-0 size-full object-cover" :style="imageStyle" fetchpriority="high">
        <!-- Tints the image with the brand color so text keeps its contrast. -->
        <div class="absolute inset-0 bg-(--brand) opacity-80" aria-hidden="true" />
      </template>
      <div class="relative max-w-3xl mx-auto px-4 py-16 sm:py-28 text-center">
        <div class="space-y-5">
          <!-- A side campaign's page is titled with its own name; the main campaign's with the site's. -->
          <p v-if="campaign" class="text-sm uppercase tracking-wide opacity-90">{{ campaign.side ? site.name : campaign.name }}</p>
          <h1 id="top-title" class="text-3xl sm:text-5xl font-bold leading-tight">{{ campaign?.side ? campaign.name : site.name }}</h1>
          <p v-if="site.description" class="text-lg opacity-95">{{ site.description }}</p>
          <p v-if="campaign?.state === 'upcoming' && campaign.startDate" class="font-medium">{{ t('landing.starts_on', { date: date(campaign.startDate) }) }}</p>
          <GoalProgress v-if="page.progress" :progress="page.progress" on-brand />
          <p v-if="page.prayingNow > 0" class="text-sm">{{ t('pray.praying_now', { n: num(page.prayingNow) }, page.prayingNow) }}</p>
          <div class="flex flex-wrap justify-center gap-3">
            <UButton to="#signup" size="xl" color="neutral" variant="solid" class="campaign-join bg-white text-stone-900 hover:bg-stone-100" :label="st('landing.signup.title')" />
            <UButton v-if="page.today" :to="link('pray')" size="xl" variant="outline" class="text-(--brand-text) ring-(--brand-text)/60 hover:bg-white/10" :label="t('landing.pray_today')" />
          </div>
        </div>
      </div>
      <p v-if="site.image?.credit" class="absolute bottom-1 end-3 text-xs opacity-80">{{ site.image.credit }}</p>
    </section>

    <div v-if="page.side.length" class="max-w-3xl mx-auto px-4 pt-10 space-y-3">
      <NuxtLink v-for="c in page.side" :key="c.slug" :to="campaignLink(c.slug)" class="flex items-center gap-4 rounded-xl border-2 border-(--brand) bg-white p-5 hover:bg-stone-50">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold uppercase tracking-wide text-(--brand)">{{ c.state === 'active' ? t('landing.side.now') : t('landing.side.soon') }}</p>
          <p class="text-xl font-bold">{{ c.name }}</p>
          <p v-if="c.startDate && c.endDate" class="text-sm text-stone-600">{{ t('landing.side.dates', { start: date(c.startDate), end: date(c.endDate) }) }}</p>
        </div>
        <span class="inline-flex shrink-0 items-center gap-1 font-medium text-(--brand)">{{ t('landing.side.open') }}<UIcon name="i-lucide-arrow-right" class="size-4 rtl:rotate-180" /></span>
      </NuxtLink>
    </div>

    <div class="max-w-3xl mx-auto px-4 py-10 space-y-14">
      <EditorPlaceholder v-if="placeholder('why')" section="why" :title="st('landing.why.title')" />
      <section v-if="has('why')" aria-labelledby="why-title" data-pt-section="why">
        <h2 id="why-title" class="text-2xl font-bold mb-4">{{ st('landing.why.title') }}</h2>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div class="pt-content" v-html="page.why" />
      </section>

      <section v-for="c in has('custom') ? page.custom : []" :key="c.id" :aria-labelledby="`custom-${c.id}`" :data-pt-custom="c.id" class="space-y-4">
        <h2 :id="`custom-${c.id}`" class="text-2xl font-bold">{{ c.heading }}</h2>
        <img v-if="c.imageUrl" :src="c.imageUrl" :alt="c.imageAlt" class="w-full rounded-xl" loading="lazy">
        <video v-if="c.video?.kind === 'file'" :src="c.video.src" controls playsinline preload="metadata" class="w-full rounded-xl bg-black aspect-video" />
        <div v-else-if="c.video" class="relative w-full aspect-video overflow-hidden rounded-xl bg-black">
          <iframe :src="c.video.src" :title="c.heading" loading="lazy" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" class="absolute inset-0 size-full border-0" />
        </div>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div class="pt-content" v-html="c.html" />
        <UButton v-if="c.buttonUrl && c.buttonLabel" :to="c.buttonUrl" target="_blank" :label="c.buttonLabel" trailing-icon="i-lucide-external-link" />
      </section>

      <EditorPlaceholder v-if="placeholder('custom')" section="custom" title="Custom sections" />
      <EditorPlaceholder v-if="placeholder('stories')" section="stories" :title="st('landing.stories.title')" />
      <section v-if="has('stories')" aria-labelledby="stories-title" data-pt-section="stories">
        <h2 id="stories-title" class="text-2xl font-bold mb-4">{{ st('landing.stories.title') }}</h2>
        <div class="grid gap-4 sm:grid-cols-2">
          <figure v-for="s in page.stories" :key="s.id" class="m-0 rounded-xl bg-white border border-stone-200 p-5">
            <blockquote class="whitespace-pre-line text-stone-800">{{ s.body }}</blockquote>
            <figcaption class="mt-3 text-sm text-stone-600">— {{ s.name || t('stories.anonymous') }}</figcaption>
          </figure>
        </div>
        <p class="mt-4"><NuxtLink :to="link('stories')" class="underline">{{ t('stories.share_link') }}</NuxtLink></p>
      </section>

      <section v-if="has('how')" aria-labelledby="how-title" data-pt-section="how">
        <h2 id="how-title" class="text-2xl font-bold mb-4">{{ st('landing.how.title') }}</h2>
        <p class="whitespace-pre-line text-stone-800">{{ st('landing.how.body', { site: site.name }) }}</p>
      </section>
    </div>

    <section id="signup" class="scroll-mt-4 bg-stone-100/70" aria-labelledby="signup-title" data-pt-section="signup">
      <div class="max-w-5xl mx-auto px-4 py-12">
        <div class="rounded-xl border border-stone-200 bg-white shadow-sm">
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
        </div>
      </div>
    </section>

    <div class="max-w-3xl mx-auto px-4 py-10 space-y-14">

      <section v-if="has('today') && page.today" aria-labelledby="today-title" data-pt-section="today">
        <h2 id="today-title" class="text-2xl font-bold mb-1">{{ st('landing.today.title') }}</h2>
        <p class="text-sm text-stone-600 mb-4">{{ t('pray.day', { n: num(page.today.day) }) }}</p>
        <div class="relative max-h-80 overflow-hidden">
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="pt-content" v-html="page.today.html" />
          <div class="absolute inset-x-0 bottom-0 h-20 bg-linear-to-t from-[#fafaf9]" />
        </div>
        <UButton :to="link('pray')" class="mt-4" :label="t('landing.continue_praying')" trailing-icon="i-lucide-arrow-right" />
      </section>

      <EditorPlaceholder v-if="placeholder('today')" section="today" :title="st('landing.today.title')" />
      <section v-if="has('share')" aria-labelledby="share-title" class="space-y-3" data-pt-section="share">
        <h2 id="share-title" class="text-2xl font-bold">{{ st('landing.share.title') }}</h2>
        <p class="text-stone-700">{{ st('landing.share.body') }}</p>
        <ShareButton />
      </section>

      <section v-if="has('contact')" aria-labelledby="contact-title" class="space-y-3" data-pt-section="contact">
        <h2 id="contact-title" class="text-2xl font-bold">{{ st('landing.contact.title') }}</h2>
        <p class="text-stone-700">{{ st('landing.contact.body') }}</p>
        <UButton :to="link('contact')" variant="outline" :label="t('contact.button')" />
      </section>

      <EditorPlaceholder v-if="placeholder('app')" section="app" :title="st('landing.app.title')" />
      <section v-if="has('app')" aria-labelledby="app-title" class="space-y-3" data-pt-section="app">
        <h2 id="app-title" class="text-2xl font-bold">{{ st('landing.app.title') }}</h2>
        <AppLinks />
      </section>
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
  </div>
</template>
