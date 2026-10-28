<script setup lang="ts">
// Onboarding, first part: what a site and a campaign are, then the site's name
// and address. Creating it here makes a draft; the rest of setup continues on
// the site (and can be resumed later from Your sites).
import { slugError as localSlugError, slugify } from '@prayertools/shared/config'

definePageMeta({ middleware: 'auth' })

const step = ref<'intro' | 'about'>('intro')
const { data: meta } = usePtMeta()
const toast = usePtToast()

const form = reactive({
  name: '',
  slug: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  turnstile: ''
})
const errors = ref<Record<string, string>>({})
const saving = ref(false)
const turnstile = ref<{ reset: () => void } | null>(null)

// The address follows the name until the user edits it.
watch(() => form.name, (next, prev) => {
  if (form.slug === '' || form.slug === slugify(prev ?? '')) form.slug = slugify(next)
})
const slugState = ref<{ slug: string, available: boolean, reason?: string, suggestion?: string } | null>(null)
let slugTimer: ReturnType<typeof setTimeout> | undefined
watch(() => form.slug, (value) => {
  clearTimeout(slugTimer)
  slugState.value = null
  delete errors.value.slug
  if (!value || localSlugError(value)) return
  slugTimer = setTimeout(async () => {
    const res = await $fetch<{ slug: string, available: boolean, reason?: string, suggestion?: string }>('/api/pt/sites/slug-check', { query: { slug: value } }).catch(() => null)
    if (res && res.slug === form.slug) slugState.value = res
  }, 400)
})
const slugMessage = computed(() => {
  if (errors.value.slug) return errors.value.slug
  if (!form.slug) return undefined
  const local = localSlugError(form.slug)
  if (local === 'reserved') return 'This address is reserved.'
  if (local) return 'Use 3–40 lowercase letters, digits and single hyphens.'
  const s = slugState.value
  if (!s || s.available) return undefined
  if (s.reason === 'taken') return `Taken${s.suggestion ? ` — try ${s.suggestion}` : ''}`
  if (s.reason === 'reserved') return 'This address is reserved.'
  if (s.reason === 'blocked') return 'Please choose another address.'
  return 'Use 3–40 lowercase letters, digits and single hyphens.'
})
const slugOk = computed(() => !!slugState.value?.available && slugState.value.slug === form.slug && !errors.value.slug)

const introCards = computed(() => [
  { icon: 'i-lucide-globe', title: 'Its own website', text: `At your-site.${meta.value?.siteBaseHost ?? 'prayer.tools'} (or your own domain), in the languages you choose.` },
  { icon: 'i-lucide-bell-ring', title: 'People sign up to pray', text: 'They choose when to be reminded and get an email (or app notification) at that time.' },
  { icon: 'i-lucide-book-open', title: 'Daily prayer content', text: 'Guided prayers from our libraries, which you can use as they are or adapt, or your own.' },
  { icon: 'i-lucide-chart-line', title: 'You see it grow', text: 'People signed up, prayer time and coverage, and stories from those praying.' }
])

async function create() {
  errors.value = {}
  saving.value = true
  try {
    const site = await $fetch<{ slug: string }>('/api/pt/sites', {
      method: 'POST',
      body: {
        ...form,
        languages: ['en'],
        default_language: 'en'
      }
    })
    await navigateTo(`/@${site.slug}/site/setup`)
  } catch (err) {
    const data = (err as { data?: { data?: { errors?: Record<string, string> } } }).data?.data
    if (data?.errors) errors.value = data.errors
    turnstile.value?.reset()
    toast.fail(err, 'Could not create the site')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto space-y-6 py-4">
    <div class="flex items-center justify-between gap-4">
      <UButton
        to="/orgs"
        variant="ghost"
        color="neutral"
        icon="i-lucide-arrow-left"
        label="Your sites"
      />
    </div>

    <div
      v-if="step === 'intro'"
      class="space-y-4"
    >
      <h1 class="text-3xl font-bold">
        Your site and its campaigns
      </h1>
      <p class="text-lg text-(--ui-text-muted)">
        Your <strong>site</strong> is your prayer website for one place, people group or event: its address, look, languages, team and the people who pray.
        A <strong>campaign</strong> is one round of prayer on it, with dates and a goal — like Ramadan 2026. When one ends, you can relaunch the next on the same site, and the people who prayed are invited back.
      </p>
      <div class="grid gap-4 sm:grid-cols-2">
        <UCard
          v-for="c in introCards"
          :key="c.title"
        >
          <div class="flex gap-3">
            <UIcon
              :name="c.icon"
              class="size-6 text-(--ui-primary) shrink-0"
            />
            <div>
              <p class="font-medium">
                {{ c.title }}
              </p>
              <p class="text-sm text-(--ui-text-muted)">
                {{ c.text }}
              </p>
            </div>
          </div>
        </UCard>
      </div>
      <p class="text-sm text-(--ui-text-muted)">
        It takes a few minutes to set up. Your site stays a private draft until you publish it, and you can stop and come back at any time.
      </p>
      <UButton
        size="lg"
        trailing-icon="i-lucide-arrow-right"
        label="Let's start"
        @click="step = 'about'"
      />
    </div>

    <form
      v-else
      class="space-y-6"
      @submit.prevent="create"
    >
      <div>
        <h1 class="text-3xl font-bold">
          Name your site
        </h1>
        <p class="text-(--ui-text-muted) mt-1">
          You'll describe it and set up its first campaign next.
        </p>
      </div>
      <UFormField
        label="Site name"
        :error="errors.name"
        required
      >
        <UInput
          v-model="form.name"
          size="lg"
          placeholder="e.g. 30 Days of Prayer for Istanbul"
          class="w-full"
          autofocus
        />
      </UFormField>
      <UFormField
        label="Address"
        help="Changing it later breaks links people already have."
        :error="slugMessage"
        required
      >
        <UInput
          v-model="form.slug"
          size="lg"
          class="w-full"
        >
          <template #trailing>
            <span class="text-xs text-(--ui-text-muted)">.{{ meta?.siteBaseHost }}</span>
          </template>
        </UInput>
      </UFormField>
      <PtTurnstile
        ref="turnstile"
        v-model="form.turnstile"
        :site-key="meta?.turnstileSiteKey || null"
      />
      <div class="flex items-center gap-3">
        <UButton
          type="submit"
          size="lg"
          label="Create site"
          trailing-icon="i-lucide-arrow-right"
          :loading="saving"
          :disabled="form.name.trim().length < 2 || !slugOk || (!!meta?.turnstileSiteKey && !form.turnstile)"
        />
        <UButton
          label="Back"
          color="neutral"
          variant="ghost"
          @click="step = 'intro'"
        />
      </div>
    </form>
  </div>
</template>
