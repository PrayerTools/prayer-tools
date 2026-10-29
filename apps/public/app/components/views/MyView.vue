<script setup lang="ts">
import type { MyConfirmSiteView, MyView, MySiteView } from '~~/shared/view'
import { timezones, type CommitmentInput } from '~/utils/commitment'

const props = defineProps<{ my: MyView, notice: string | null, continueTo: string | null, confirmSite: MyConfirmSiteView | null, lang: string, donateUrl: string }>()
const { t } = useI18n()
const route = useRoute()
const toast = useToast()
useHead({ title: () => `${t('my.title')} · Prayer.Tools` })

const email = ref('')
const sent = ref(false)
const busy = ref(false)
const confirmDelete = ref(false)
const tzItems = timezones()

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

async function call(s: MySiteView, path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: Record<string, unknown>) {
  busy.value = true
  try {
    await $fetch(`/api/my/${s.orgId}/${s.subscriptionId}/${path}`, { method: method as 'POST', body })
    toast.add({ title: t('manage.saved'), color: 'success', icon: 'i-lucide-check' })
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

function languageItems(s: MySiteView) {
  return s.languages.map(l => ({ label: l.native, value: l.code }))
}
</script>

<template>
  <div class="min-h-dvh flex flex-col">
    <header class="bg-[#2f6f5e] text-white">
      <div class="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
        <a href="https://prayer.tools" class="font-bold text-lg me-auto">Prayer.Tools</a>
        <UButton v-if="my.signedIn" variant="ghost" color="neutral" class="text-white hover:bg-white/10" icon="i-lucide-log-out" :label="t('my.sign_out')" @click="signOut" />
      </div>
    </header>
    <main id="main" class="flex-1 max-w-4xl w-full mx-auto px-4 py-10 space-y-8">
      <h1 class="text-3xl font-bold">{{ t('my.title') }}</h1>
      <UAlert v-if="notice" color="neutral" variant="soft" icon="i-lucide-info" :title="t(`my.notice_${notice}`)" role="status" />

      <section v-if="!my.signedIn" class="max-w-lg space-y-4" aria-labelledby="my-signin">
        <h2 id="my-signin" class="sr-only">{{ t('my.sign_in') }}</h2>
        <p class="text-stone-700">{{ t('my.intro') }}</p>
        <UAlert v-if="sent" color="success" variant="soft" icon="i-lucide-mail" :title="t('my.sent')" role="status" />
        <form v-else class="space-y-4" @submit.prevent="requestLink">
          <UFormField :label="t('signup.email')" name="my-email" required>
            <UInput v-model="email" type="email" autocomplete="email" required class="w-full" />
          </UFormField>
          <UButton type="submit" :loading="busy" icon="i-lucide-send" :label="t('my.send_link')" />
        </form>
      </section>

      <template v-else>
        <section v-if="confirmSite" class="rounded-2xl bg-white border border-stone-200 p-6 space-y-4" aria-labelledby="my-confirm-site">
          <h2 id="my-confirm-site" class="text-xl font-bold">{{ t('my.continue_title', { site: confirmSite.name }) }}</h2>
          <p class="text-stone-700">{{ t('my.continue_body', { site: confirmSite.name, host: confirmSite.host, email: my.account?.email ?? '' }) }}</p>
          <div class="flex flex-wrap gap-2">
            <UButton :loading="busy" :label="t('my.continue_button', { site: confirmSite.name })" @click="continueToSite(confirmSite)" />
            <UButton variant="outline" color="neutral" to="/my" :label="t('common.cancel')" />
          </div>
        </section>
        <section v-if="my.account" class="rounded-2xl bg-white border border-stone-200 p-6 space-y-4" aria-labelledby="my-account">
          <h2 id="my-account" class="text-xl font-bold">{{ t('my.account_title') }}</h2>
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
          <h2 id="my-managing" class="text-xl font-bold">{{ t('my.managing_title') }}</h2>
          <ul v-if="my.managing.length" class="space-y-2">
            <li v-for="m in my.managing" :key="m.adminUrl" class="flex flex-wrap items-center gap-3 rounded-xl bg-white border border-stone-200 px-4 py-3">
              <span class="font-medium me-auto">{{ m.name }}</span>
              <UButton :to="m.adminUrl" external variant="ghost" trailing-icon="i-lucide-external-link" :label="t('my.manage_site')" />
            </li>
          </ul>
          <p v-else class="text-stone-700">{{ t('my.managing_empty') }}</p>
          <UButton v-if="my.createUrl" :to="my.createUrl" external icon="i-lucide-plus" :label="t('my.create_campaign')" />
        </section>

        <h2 class="text-xl font-bold">{{ t('my.praying_title') }}</h2>
        <p v-if="!my.sites.length" class="text-stone-700">{{ t('my.empty') }}</p>
        <article v-for="s in my.sites" :key="s.subscriptionId" class="rounded-2xl bg-white border border-stone-200 p-6 space-y-6" :aria-labelledby="`site-${s.subscriptionId}`">
          <header class="flex flex-wrap items-center gap-3">
            <h3 :id="`site-${s.subscriptionId}`" class="text-xl font-bold me-auto">{{ s.name }}</h3>
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
          </section>

          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField v-if="s.languages.length > 1" :label="t('signup.language')" :name="`lang-${s.subscriptionId}`">
              <USelect :model-value="s.language" :items="languageItems(s)" class="w-full" @update:model-value="v => call(s, 'profile', 'POST', { language: v })" />
            </UFormField>
            <UFormField :label="t('signup.timezone')" :name="`tz-${s.subscriptionId}`">
              <USelectMenu :model-value="s.timezone" :items="tzItems" class="w-full" @update:model-value="v => call(s, 'profile', 'POST', { timezone: v })" />
            </UFormField>
          </div>

          <div class="space-y-2">
            <USwitch :model-value="s.siteUpdates" :label="t('consent.site_updates', { site: s.name })" @update:model-value="v => call(s, 'consent', 'POST', { purpose: 'site_updates', grant: !!v })" />
            <USwitch v-for="c in s.customConsents" :key="c.key" :model-value="c.granted" :label="c.label" @update:model-value="v => call(s, 'consent', 'POST', { purpose: c.key, grant: !!v })" />
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

        <section class="space-y-3 border-t border-stone-200 pt-6" aria-labelledby="my-data">
          <h2 id="my-data" class="text-xl font-semibold">{{ t('manage.your_data') }}</h2>
          <div class="flex flex-wrap gap-2">
            <UButton variant="outline" icon="i-lucide-download" href="/api/my/export" external :label="t('manage.download')" />
            <UButton variant="outline" color="error" icon="i-lucide-trash-2" :label="t('my.delete_all')" @click="confirmDelete = true" />
          </div>
        </section>
        <UModal v-model:open="confirmDelete" :title="t('manage.delete_confirm_title')" :description="t('my.delete_all_body')">
          <template #footer>
            <UButton color="error" :loading="busy" :label="t('manage.delete_confirm')" @click="deleteAll" />
            <UButton variant="ghost" color="neutral" :label="t('common.cancel')" @click="confirmDelete = false" />
          </template>
        </UModal>
      </template>
    </main>
    <footer class="border-t border-stone-200 bg-white text-sm text-stone-600">
      <div class="max-w-4xl mx-auto px-4 py-6 flex flex-wrap gap-x-6 gap-y-2">
        <a :href="donateUrl" class="underline me-auto">{{ t('footer.give') }}</a>
        <a href="/privacy" class="underline">{{ t('footer.privacy') }}</a>
        <a href="/terms" class="underline">{{ t('footer.terms') }}</a>
      </div>
    </footer>
  </div>
</template>
