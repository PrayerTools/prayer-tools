<script setup lang="ts">
// Compact widget for other websites (framed by /embed.js); reports its height
// to the parent page so the iframe can resize. Links open the site in a new
// tab, since the site's cookies don't reach a page inside another site's frame.
import type { GoalProgressView, SignupFormView } from '~~/shared/view'

defineProps<{ progress: GoalProgressView | null, form: SignupFormView | null }>()
const { site, link, st, date } = useSite()
const { t } = useI18n()
const root = ref<HTMLElement | null>(null)
const joined = ref<{ verify: boolean } | null>(null)

onMounted(() => {
  // The widget's own height, so the frame also shrinks when the form closes.
  const post = () => window.parent?.postMessage({ type: 'pt-embed-height', height: root.value?.offsetHeight ?? document.documentElement.scrollHeight }, '*')
  post()
  if (root.value && 'ResizeObserver' in window) new ResizeObserver(post).observe(root.value)
})
</script>

<template>
  <main ref="root" class="p-4 space-y-3 bg-white">
    <p class="font-bold text-lg">{{ site.name }}</p>
    <p v-if="site.campaign?.state === 'upcoming' && site.campaign.startDate" class="text-sm">{{ t('landing.starts_on', { date: date(site.campaign.startDate) }) }}</p>
    <GoalProgress v-if="progress" :progress="progress" />
    <template v-if="form">
      <template v-if="joined">
        <UAlert v-if="joined.verify" color="warning" variant="soft" icon="i-lucide-mail" :title="t('pray.check_email_title')" :description="t('pray.check_email_body_not_started')" role="status" />
        <UAlert v-else color="success" variant="soft" icon="i-lucide-check" :title="st('signup.success')" role="status" />
        <div class="flex flex-wrap gap-2">
          <UButton v-if="site.campaign?.state === 'active'" :to="site.url + link('pray')" target="_blank" :label="t('landing.pray_today')" />
          <UButton :to="site.url + link()" target="_blank" variant="outline" :label="t('embed.open_site')" />
        </div>
      </template>
      <SignupForm v-else :form="form" embedded @joined="verify => (joined = { verify })" />
    </template>
    <div v-else class="flex flex-wrap gap-2">
      <UButton v-if="site.campaign && (site.campaign.state === 'active' || site.campaign.state === 'upcoming')" :to="site.url + link('signup')" target="_blank" :label="st(site.campaign.goal === 'coverage' ? 'landing.signup.button' : 'landing.signup.title')" />
      <UButton v-if="site.campaign?.goal === 'coverage'" :to="site.url + link('coverage')" target="_blank" variant="outline" :label="t('nav.coverage')" />
      <UButton v-else-if="site.campaign?.state !== 'upcoming'" :to="site.url + link('pray')" target="_blank" variant="outline" :label="t('landing.pray_today')" />
    </div>
  </main>
</template>
