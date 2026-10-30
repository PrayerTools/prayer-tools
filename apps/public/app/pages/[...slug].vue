<script setup lang="ts">
import type { ViewResponse, SiteView } from '~~/shared/view'
import { SITE_KEY } from '~/composables/useSite'

const route = useRoute()
const event = import.meta.server ? useRequestEvent() : null
const { setLocale } = useI18n()

const { data: view, error } = await useAsyncData(`view:${route.path}`, () => {
  if (import.meta.server) return Promise.resolve(event!.context.ptView as ViewResponse)
  return $fetch<ViewResponse>('/api/view', { query: { path: route.fullPath } })
})
if (error.value || !view.value) throw createError({ statusCode: error.value?.statusCode ?? 404, statusMessage: 'Not found', fatal: true })

const uiLang = computed(() => view.value!.host === 'site' ? view.value!.site.uiLang : view.value!.lang)
await setLocale(uiLang.value as 'en')

const site = computed(() => (view.value!.host === 'site' ? view.value!.site : null) as SiteView)
provide(SITE_KEY, site)
useEditorBridge(view)

useHead(() => {
  const v = view.value!
  if (v.host !== 'site') {
    return { htmlAttrs: { lang: v.lang, dir: v.lang === 'ar' ? 'rtl' : 'ltr' }, meta: [{ name: 'robots', content: 'noindex' }] }
  }
  const s = v.site
  return {
    htmlAttrs: { lang: s.lang, dir: s.dir, style: `--brand:${s.brand.color};--brand-text:${s.brand.text};--ui-text-inverted:${s.brand.text}` },
    link: v.canonical && v.cache === 'shared' ? [{ rel: 'canonical', href: v.canonical }] : [],
    meta: [
      { name: 'description', content: s.description },
      { name: 'theme-color', content: s.brand.color },
      { property: 'og:site_name', content: s.name },
      { property: 'og:title', content: s.name },
      { property: 'og:description', content: s.description },
      ...(s.shareImageUrl ? [{ property: 'og:image', content: s.shareImageUrl }] : []),
      { name: 'twitter:card', content: s.shareImageUrl ? 'summary_large_image' : 'summary' },
      ...(v.robots ? [{ name: 'robots', content: v.robots }] : [])
    ]
  }
})
</script>

<template>
  <div v-if="view">
    <template v-if="view.host === 'platform'">
      <LazyViewsMyView v-if="view.page.kind === 'my'" :my="view.page.my" :notice="view.page.notice" :continue-to="view.page.continueTo" :confirm-site="view.page.confirmSite" :lang="view.lang" :donate-url="view.donateUrl" />
      <LazyViewsHomeView v-else-if="view.page.kind === 'home'" :admin-url="view.page.adminUrl" />
      <LazyViewsLegalView v-else-if="view.page.kind === 'legal'" :doc="view.page.doc" />
      <PlainNotFound v-else />
    </template>
    <template v-else>
      <LazyViewsEmbedView v-if="view.page.kind === 'embed'" :progress="view.page.progress" />
      <SiteShell v-else :page="view.page.kind">
        <LazyViewsLandingView v-if="view.page.kind === 'landing'" :page="view.page" />
        <LazyViewsBetweenView v-else-if="view.page.kind === 'between'" :page="view.page" />
        <LazyViewsArchivedView v-else-if="view.page.kind === 'archived'" />
        <LazyViewsPrayView v-else-if="view.page.kind === 'pray'" :page="view.page" />
        <LazyViewsNotStartedView v-else-if="view.page.kind === 'not_started'" :page="view.page" />
        <LazyViewsSignupView v-else-if="view.page.kind === 'signup'" :form="view.page.form" />
        <LazyViewsStatsView v-else-if="view.page.kind === 'stats'" :stats="view.page.stats" />
        <LazyViewsCoverageView v-else-if="view.page.kind === 'coverage'" :progress="view.page.progress" />
        <LazyViewsContactView v-else-if="view.page.kind === 'contact'" :fields="view.page.fields" />
        <LazyViewsStoriesView v-else-if="view.page.kind === 'stories'" />
        <LazyViewsManageView v-else-if="view.page.kind === 'manage'" :manage="view.page.manage" />
        <LazyViewsLinkExpiredView v-else-if="view.page.kind === 'link_expired'" :token="view.page.token" />
        <LazyViewsUnsubscribeView v-else-if="view.page.kind === 'unsubscribe'" :token="view.page.token" :valid="view.page.valid" />
        <LazyViewsNoticeView v-else-if="view.page.kind === 'notice'" :notice-key="view.page.key" />
        <LazyViewsNotFoundView v-else />
      </SiteShell>
    </template>
  </div>
</template>
