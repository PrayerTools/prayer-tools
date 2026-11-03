<script setup lang="ts">
import type { FeedbackView, MyConfirmSiteView, MyView, MySiteView, SignInProvidersView } from '~~/shared/view'
import { timezones, type CommitmentInput } from '~/utils/commitment'

const props = defineProps<{ my: MyView, notice: string | null, continueTo: string | null, confirmSite: MyConfirmSiteView | null, signIn: SignInProvidersView, lang: string, donateUrl: string, feedback: FeedbackView | null }>()
const { t } = useI18n()
const themeStyle = usePlatformTheme()
const route = useRoute()
const toast = useToast()
useHead({ title: () => `${t('my.title')} · Prayer.Tools` })

const email = ref('')
const sent = ref(false)
const busy = ref(false)
const confirmDelete = ref(false)
const stopping = ref<'reminders' | 'all' | null>(null)
const leaveOpen = ref(false)
const leaving = ref<{ site: MySiteView, id: string, name: string } | null>(null)
const tzItems = timezones()
const continueQuery = computed(() => props.continueTo ? `?continue=${encodeURIComponent(props.continueTo)}` : '')
const googleUrl = computed(() => props.signIn.google ? `/my/google${continueQuery.value}` : null)
const appleUrl = computed(() => props.signIn.apple ? `/my/apple${continueQuery.value}` : null)

async function requestLink() {
  busy.value = true
  try {
    await $fetch('/api/my/link', { method: 'POST', body: { email: email.value, language: props.lang, continue: props.continueTo } })
  } catch {
    // the answer is the same either way
  }
  sent.value = true
  busy.value = false
}

async function call(s: MySiteView, path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: Record<string, unknown>, message = t('manage.saved')) {
  busy.value = true
  try {
    await $fetch(`/api/my/${s.orgId}/${s.subscriptionId}/${path}`, { method: method as 'POST', body })
    toast.add({ title: message, color: 'success', icon: 'i-lucide-check' })
    await refreshNuxtData(`view:${route.path}`)
  } catch {
    toast.add({ title: t('errors.generic'), color: 'error' })
  } finally {
    busy.value = false
  }
}

const name = ref(props.my.account?.name ?? '')
const newEmail = ref('')
const emailSent = ref(false)
// Set when an action needs a fresh sign-in (an email change after a while).
const reauthNeeded = ref(false)

async function saveName() {
  busy.value = true
  try {
    await $fetch('/api/my/account', { method: 'POST', body: { name: name.value } })
    toast.add({ title: t('manage.saved'), color: 'success', icon: 'i-lucide-check' })
    await refreshNuxtData(`view:${route.path}`)
  } catch {
    toast.add({ title: t('errors.generic'), color: 'error' })
  } finally {
    busy.value = false
  }
}

async function changeEmail() {
  busy.value = true
  try {
    await $fetch('/api/my/email', { method: 'POST', body: { email: newEmail.value, language: props.lang } })
    emailSent.value = true
  } catch (err) {
    if ((err as { data?: { data?: { reauth?: boolean } } }).data?.data?.reauth) reauthNeeded.value = true
    else toast.add({ title: t('errors.generic'), color: 'error' })
  } finally {
    busy.value = false
  }
}

async function requestFreshLink() {
  busy.value = true
  try {
    await $fetch('/api/my/link', { method: 'POST', body: { email: props.my.account?.email, language: props.lang, continue: props.continueTo } })
    sent.value = true
  } catch {
    toast.add({ title: t('errors.generic'), color: 'error' })
  } finally {
    busy.value = false
  }
}

async function continueToSite(site: MyConfirmSiteView) {
  busy.value = true
  try {
    const res = await $fetch<{ url: string }>('/api/my/continue', { method: 'POST', body: { host: site.host, return: site.returnTo } })
    await navigateTo(res.url, { external: true })
  } catch {
    toast.add({ title: t('errors.generic'), color: 'error' })
    busy.value = false
  }
}

const accountItems = computed(() => [
  [{ label: t('account.my_account'), icon: 'i-lucide-user', onSelect: () => document.getElementById('my-account')?.scrollIntoView({ behavior: 'smooth' }) }],
  [{ label: t('my.sign_out'), icon: 'i-lucide-log-out', onSelect: signOut }]
])

async function signOut() {
  await $fetch('/api/my/logout', { method: 'POST' }).catch(() => null)
  await navigateTo('/my?notice=signed_out', { external: true })
}

async function deleteAll() {
  busy.value = true
  try {
    const res = await $fetch<{ account_deleted: boolean }>('/api/my/delete', { method: 'POST' })
    await navigateTo(`/my?notice=${res.account_deleted ? 'deleted' : 'deleted_kept'}`, { external: true })
  } finally {
    busy.value = false
  }
}

async function setNews(grant: boolean) {
  busy.value = true
  try {
    await $fetch('/api/my/news', { method: 'POST', body: { grant } })
    toast.add({ title: t('manage.saved'), color: 'success', icon: 'i-lucide-check' })
    await refreshNuxtData(`view:${route.path}`)
  } catch {
    toast.add({ title: t('errors.generic'), color: 'error' })
  } finally {
    busy.value = false
  }
}

async function stopAll() {
  busy.value = true
  try {
    const emails = stopping.value === 'all'
    await $fetch('/api/my/stop-all', { method: 'POST', body: { emails } })
    await navigateTo(`/my?notice=${emails ? 'stopped_all' : 'stopped_reminders'}`, { external: true })
  } catch {
    toast.add({ title: t('errors.generic'), color: 'error' })
  } finally {
    busy.value = false
  }
}

function askLeave(s: MySiteView, campaign: { id: string, name: string }) {
  leaving.value = { site: s, id: campaign.id, name: campaign.name }
  leaveOpen.value = true
}

async function leave() {
  if (!leaving.value) return
  await call(leaving.value.site, 'leave', 'POST', { campaign: leaving.value.id }, t('manage.left', { campaign: leaving.value.name }))
  leaveOpen.value = false
}

function languageItems(s: MySiteView) {
  return s.languages.map(l => ({ label: l.native, value: l.code }))
}
</script>

<template>
  <div class="my-page min-h-dvh flex flex-col bg-[#fffaf5] text-[#202833] dark:text-slate-100" :style="themeStyle">
    <PlatformHeader>
      <AccountMenu v-if="my.signedIn" :account="my.account" ready :sign-in-href="null" :items="accountItems" button-class="text-white hover:bg-white/10" />
    </PlatformHeader>
    <main id="main" class="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-12 sm:py-16 space-y-8">
      <div class="space-y-4">
        <div class="h-1 w-12 rounded-full bg-[#f58220]" aria-hidden="true" />
        <h1 class="text-3xl sm:text-4xl font-semibold tracking-tight">{{ t('my.title') }}</h1>
      </div>
      <UAlert v-if="notice" color="neutral" variant="soft" icon="i-lucide-info" :title="t(`my.notice_${notice}`)" role="status" />

      <section v-if="!my.signedIn" class="max-w-lg space-y-4" aria-labelledby="my-signin">
        <h2 id="my-signin" class="sr-only">{{ t('my.sign_in') }}</h2>
        <p class="text-stone-700">{{ t('my.intro') }}</p>
        <UAlert v-if="sent" color="success" variant="soft" icon="i-lucide-mail" :title="t('my.sent')" role="status" />
        <SignInButtons v-if="(googleUrl || appleUrl) && !sent" :google-href="googleUrl" :google-label="t('my.google')" :apple-href="appleUrl" :apple-label="t('my.apple')" />
        <form v-if="!sent" class="space-y-4" @submit.prevent="requestLink">
          <UFormField :label="t('signup.email')" name="my-email" required>
            <UInput v-model="email" type="email" autocomplete="email" required class="w-full" />
          </UFormField>
          <UButton type="submit" :loading="busy" icon="i-lucide-send" :label="t('my.send_link')" />
        </form>
      </section>

      <template v-else>
        <section v-if="(notice === 'reauth' || reauthNeeded) && my.account?.email" class="my-card rounded-lg bg-white p-6 space-y-4" aria-labelledby="my-reauth">
          <h2 id="my-reauth" class="text-xl font-semibold tracking-tight">{{ t('my.reauth_title') }}</h2>
          <p v-if="notice !== 'reauth'" class="text-stone-700">{{ t('my.reauth_email') }}</p>
          <UAlert v-if="sent" color="success" variant="soft" icon="i-lucide-mail" :title="t('my.reauth_sent', { email: my.account.email })" role="status" />
          <SignInButtons v-if="(googleUrl || appleUrl) && !sent" :google-href="googleUrl" :google-label="t('my.google')" :apple-href="appleUrl" :apple-label="t('my.apple')" />
          <UButton v-if="!sent" :loading="busy" icon="i-lucide-send" :label="t('my.reauth_send')" @click="requestFreshLink" />
        </section>
        <section v-if="confirmSite" class="my-card rounded-lg bg-white p-6 space-y-4" aria-labelledby="my-confirm-site">
          <h2 id="my-confirm-site" class="text-xl font-semibold tracking-tight">{{ t('my.continue_title', { site: confirmSite.name }) }}</h2>
          <p class="text-stone-700">{{ t('my.continue_body', { site: confirmSite.name, host: confirmSite.host, email: my.account?.email ?? '' }) }}</p>
          <div class="flex flex-wrap gap-2">
            <UButton :loading="busy" :label="t('my.continue_button', { site: confirmSite.name })" @click="continueToSite(confirmSite)" />
            <UButton variant="outline" color="neutral" to="/my" :label="t('common.cancel')" />
          </div>
        </section>
        <section v-if="my.account" class="my-card rounded-lg bg-white p-6 space-y-4" aria-labelledby="my-account">
          <h2 id="my-account" class="text-xl font-semibold tracking-tight">{{ t('my.account_title') }}</h2>
          <p class="text-sm text-stone-600">{{ t('my.account_help') }}</p>
          <form class="flex flex-wrap items-end gap-2" @submit.prevent="saveName">
            <UFormField :label="t('my.name')" name="my-name" class="grow sm:grow-0 sm:w-72">
              <UInput v-model="name" autocomplete="name" class="w-full" />
            </UFormField>
            <UButton type="submit" variant="outline" :loading="busy" :disabled="!name.trim() || name.trim() === my.account.name" :label="t('my.save_name')" />
          </form>
          <div class="space-y-2">
            <p class="text-sm"><span class="text-stone-600">{{ t('signup.email') }}:</span> {{ my.account.email }}</p>
            <UAlert v-if="emailSent" color="success" variant="soft" icon="i-lucide-mail" :title="t('my.email_sent')" role="status" />
            <form v-else class="flex flex-wrap items-end gap-2" @submit.prevent="changeEmail">
              <UFormField :label="t('my.new_email')" name="my-new-email" class="grow sm:grow-0 sm:w-72">
                <UInput v-model="newEmail" type="email" autocomplete="email" required class="w-full" />
              </UFormField>
              <UButton type="submit" variant="outline" :loading="busy" icon="i-lucide-send" :label="t('my.change_email')" />
            </form>
          </div>
        </section>

        <section class="space-y-3" aria-labelledby="my-managing">
          <h2 id="my-managing" class="text-xl font-semibold tracking-tight">{{ t('my.managing_title') }}</h2>
          <ul v-if="my.managing.length" class="space-y-2">
            <li v-for="m in my.managing" :key="m.adminUrl" class="my-card flex flex-wrap items-center gap-3 rounded-lg bg-white px-4 py-3">
              <span class="font-medium me-auto">{{ m.name }}</span>
              <UButton :to="m.adminUrl" external variant="ghost" trailing-icon="i-lucide-external-link" :label="t('my.manage_site')" />
            </li>
          </ul>
          <p v-else class="text-stone-700">{{ t('my.managing_empty') }}</p>
          <UButton v-if="my.createUrl" :to="my.createUrl" external icon="i-lucide-plus" :label="t('my.create_campaign')" />
        </section>

        <h2 class="text-xl font-semibold tracking-tight">{{ t('my.praying_title') }}</h2>
        <p v-if="!my.sites.length" class="text-stone-700">{{ t('my.empty') }}</p>
        <article v-for="s in my.sites" :key="s.subscriptionId" class="my-card rounded-lg bg-white p-6 space-y-6" :aria-labelledby="`site-${s.subscriptionId}`">
          <header class="flex flex-wrap items-center gap-3">
            <h3 :id="`site-${s.subscriptionId}`" class="text-xl font-semibold tracking-tight me-auto">{{ s.name }}</h3>
            <UBadge v-if="s.status !== 'active'" color="neutral" variant="soft" :label="t(`my.status_${s.status}`)" />
            <UButton :to="s.url" external variant="ghost" trailing-icon="i-lucide-external-link" :label="t('my.open_site')" />
          </header>

          <section v-for="cur in s.current" :key="cur.campaign.id" class="space-y-3">
            <h4 class="font-semibold">{{ cur.campaign.name }}</h4>
            <CommitmentList
              :commitments="cur.commitments"
              :duration-rule="cur.campaign.durationRule"
              :durations="cur.campaign.durations"
              :default-duration="cur.campaign.defaultDuration"
              :can-add="s.status !== 'unsubscribed'"
              :lang="lang"
              :busy="busy"
              @add="(i: CommitmentInput) => call(s, 'commitments', 'POST', { ...i, campaign: cur.campaign.id })"
              @update="(id: string, i: CommitmentInput) => call(s, `commitments/${id}`, 'PATCH', { ...i })"
              @pause="(id: string, p: boolean) => call(s, `commitments/${id}`, 'PATCH', { paused: p })"
              @remove="(id: string) => call(s, `commitments/${id}`, 'DELETE')"
            />
            <UButton
              v-if="cur.commitments.length"
              size="sm"
              variant="link"
              color="neutral"
              icon="i-lucide-log-out"
              :label="t('manage.leave', { campaign: cur.campaign.name })"
              @click="askLeave(s, cur.campaign)"
            />
          </section>

          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField v-if="s.languages.length > 1" :label="t('signup.language')" :name="`lang-${s.subscriptionId}`">
              <USelect :model-value="s.language" :items="languageItems(s)" class="w-full" @update:model-value="v => call(s, 'profile', 'POST', { language: v })" />
            </UFormField>
            <UFormField :label="t('signup.timezone')" :name="`tz-${s.subscriptionId}`">
              <USelectMenu :model-value="s.timezone" :items="tzItems" class="w-full" @update:model-value="v => call(s, 'profile', 'POST', { timezone: v })" />
            </UFormField>
          </div>

          <div class="flex flex-wrap gap-2">
            <UButton v-if="s.status !== 'unsubscribed'" size="sm" variant="outline" color="neutral" icon="i-lucide-bell-off" :label="t('manage.unsubscribe')" @click="call(s, 'status', 'POST', { status: 'unsubscribed' })" />
            <UButton v-else size="sm" variant="outline" icon="i-lucide-bell" :label="t('manage.resubscribe')" @click="call(s, 'status', 'POST', { status: 'active' })" />
          </div>

          <section v-if="s.past.length" class="space-y-2">
            <h4 class="font-semibold">{{ t('my.past') }}</h4>
            <ul class="space-y-1 text-stone-700">
              <li v-for="p in s.past" :key="p.id">{{ t('my.past_line', { name: p.name, prayers: p.prayers, minutes: p.minutes }) }}</li>
            </ul>
          </section>
        </article>

        <section class="space-y-3" aria-labelledby="my-emails">
          <h2 id="my-emails" class="text-xl font-semibold tracking-tight">{{ t('my.emails_title') }}</h2>
          <div class="my-card rounded-lg bg-white p-6 space-y-2">
            <USwitch :model-value="my.news" :label="t('consent.platform_news')" @update:model-value="v => setNews(!!v)" />
            <template v-for="s in my.sites" :key="s.subscriptionId">
              <USwitch :model-value="s.siteUpdates" :label="t('consent.site_updates', { site: s.name })" @update:model-value="v => call(s, 'consent', 'POST', { purpose: 'site_updates', grant: !!v })" />
              <USwitch v-for="c in s.customConsents" :key="c.key" :model-value="c.granted" :label="`${s.name}: ${c.label}`" @update:model-value="v => call(s, 'consent', 'POST', { purpose: c.key, grant: !!v })" />
            </template>
          </div>
        </section>

        <div v-if="my.sites.length" class="flex flex-wrap gap-2">
          <UButton variant="outline" color="neutral" icon="i-lucide-bell-off" :label="t('my.stop_reminders')" @click="stopping = 'reminders'" />
          <UButton variant="outline" color="neutral" icon="i-lucide-mail-x" :label="t('my.stop_all')" @click="stopping = 'all'" />
        </div>
        <UModal :open="!!stopping" :title="t(stopping === 'all' ? 'my.stop_all_title' : 'my.stop_reminders_title')" :description="t(stopping === 'all' ? 'my.stop_all_body' : 'my.stop_reminders_body')" @update:open="v => { if (!v) stopping = null }">
          <template #footer>
            <UButton color="error" :loading="busy" :label="t(stopping === 'all' ? 'my.stop_all' : 'my.stop_reminders')" @click="stopAll" />
            <UButton variant="ghost" color="neutral" :label="t('common.cancel')" @click="stopping = null" />
          </template>
        </UModal>

        <section class="space-y-3 border-t border-stone-200 pt-6" aria-labelledby="my-data">
          <h2 id="my-data" class="text-xl font-semibold tracking-tight">{{ t('manage.your_data') }}</h2>
          <div class="flex flex-wrap gap-2">
            <UButton variant="outline" icon="i-lucide-download" href="/api/my/export" external :label="t('manage.download')" />
            <UButton variant="outline" color="error" icon="i-lucide-trash-2" :label="t('my.delete_all')" @click="confirmDelete = true" />
          </div>
        </section>
        <UModal v-model:open="leaveOpen" :title="t('manage.leave_confirm_title', { campaign: leaving?.name ?? '' })" :description="t('manage.leave_confirm_body', { campaign: leaving?.name ?? '', site: leaving?.site.name ?? '' })">
          <template #footer>
            <UButton color="error" :loading="busy" :label="t('manage.leave', { campaign: leaving?.name ?? '' })" @click="leave" />
            <UButton variant="ghost" color="neutral" :label="t('common.cancel')" @click="leaveOpen = false" />
          </template>
        </UModal>
        <UModal v-model:open="confirmDelete" :title="t('manage.delete_confirm_title')" :description="t('my.delete_all_body')">
          <template #footer>
            <UButton color="error" :loading="busy" :label="t('manage.delete_confirm')" @click="deleteAll" />
            <UButton variant="ghost" color="neutral" :label="t('common.cancel')" @click="confirmDelete = false" />
          </template>
        </UModal>
      </template>
    </main>
    <footer class="mx-6 border-t border-[#e8ded5] py-8 text-sm">
      <nav aria-label="Footer" class="flex flex-wrap justify-center gap-x-6 gap-y-3 text-stone-700">
        <a :href="donateUrl" class="hover:underline underline-offset-4">{{ t('footer.give') }}</a>
        <a href="/privacy" class="hover:underline underline-offset-4">{{ t('footer.privacy') }}</a>
        <a href="/terms" class="hover:underline underline-offset-4">{{ t('footer.terms') }}</a>
      </nav>
    </footer>
    <ClientOnly>
      <FeedbackWidget v-if="feedback" :feedback="feedback" :context="{ 'data-language': lang }" />
    </ClientOnly>
  </div>
</template>

<style scoped>
.my-card { border: 1px solid #eee5dc; box-shadow: 0 8px 30px #50321a05; }
</style>
