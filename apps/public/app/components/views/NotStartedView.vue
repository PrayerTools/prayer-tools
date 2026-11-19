<script setup lang="ts">
// The pray page before a dated campaign's first day: no prayer content yet.
import type { PageView } from '~~/shared/view'

defineProps<{ page: Extract<PageView, { kind: 'not_started' }> }>()
const { site, link, st, date } = useSite()
const { t } = useI18n()
const route = useRoute()

useHead({ title: () => site.value.name })

const joined = computed(() => route.query.joined === '1')
const needsVerify = computed(() => route.query.verify === '1')
const confirmed = computed(() => route.query.confirmed === '1')
const sharePrompt = ref(false)
const verifyPrompt = ref(false)
const signupEmail = useState<string | null>('pt-signup-email', () => null)

onMounted(() => {
  if (joined.value && needsVerify.value) verifyPrompt.value = true
  else if ((joined.value || confirmed.value) && site.value.settings.sharePrompts) setTimeout(() => (sharePrompt.value = true), 1200)
  dropQueryParams('confirmed', 'joined', 'verify')
})
</script>

<template>
  <article>
    <div class="border-b border-stone-200 bg-white">
      <div class="max-w-3xl mx-auto px-4 py-8 sm:py-10 space-y-5">
        <UAlert v-if="joined && needsVerify" color="warning" variant="soft" icon="i-lucide-mail" :title="t('pray.check_email_title')" :description="t('pray.check_email_body_not_started')" role="status" />
        <UAlert v-else-if="joined" color="success" variant="soft" icon="i-lucide-check" :title="st('signup.success')" role="status" />
        <UAlert v-if="confirmed" color="success" variant="soft" icon="i-lucide-badge-check" :title="t('pray.confirmed_title')" :description="t('pray.confirmed_body')" role="status" />
        <header class="space-y-2">
          <h1 class="text-3xl sm:text-4xl font-bold tracking-tight text-balance">{{ t('pray.not_started_title', { date: date(page.startDate) }) }}</h1>
          <p class="text-stone-600">{{ t('pray.not_started_body') }}</p>
        </header>
        <NuxtLink v-if="site.campaign" :to="link()" class="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline">
          <UIcon name="i-lucide-house" class="size-4 shrink-0" />{{ site.campaign.name }} · {{ t('manage.home_link') }}
        </NuxtLink>
      </div>
    </div>

    <div class="max-w-3xl mx-auto px-4 py-8 sm:py-10">
      <aside class="grid gap-6 sm:grid-cols-2">
        <SectionCard v-if="!joined" :title="t('pray.get_reminders')" title-id="reminders-title">
          <div class="space-y-4 py-5">
            <p class="text-stone-700">{{ st('landing.signup.intro', { site: site.name }) }}</p>
            <UButton :to="link('signup')" variant="outline" icon="i-lucide-bell" :label="st(site.campaign?.goal === 'coverage' ? 'landing.signup.button' : 'landing.signup.title')" />
          </div>
        </SectionCard>
        <SectionCard :title="t('share.invite')" title-id="share-title" :class="joined && 'sm:col-span-2'">
          <div class="py-4">
            <ShareButton size="md" variant="soft" />
          </div>
        </SectionCard>
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
