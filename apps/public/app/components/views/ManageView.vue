<script setup lang="ts">
import type { ManageCampaignView, ManageView } from '~~/shared/view'
import { timezones, type CommitmentInput } from '~/utils/commitment'

const props = defineProps<{ manage: ManageView | null }>()
const { site, link } = useSite()
const { t } = useI18n()
const route = useRoute()
const toast = useToast()
useHead({ title: () => `${t('manage.title')} · ${site.value.name}` })

const busy = ref(false)
const confirmDelete = ref(false)
const profile = reactive({ name: props.manage?.name ?? '', language: props.manage?.language ?? site.value.lang, timezone: props.manage?.timezone ?? 'UTC' })
const tzItems = timezones()
const languageItems = computed(() => site.value.languages.map(l => ({ label: l.native, value: l.code })))
// A personal-start campaign holds one prayer time per person, which carries their progress.
const canAdd = (c: ManageCampaignView) => c.state !== 'ended' && props.manage?.status !== 'unsubscribed' && !(c.personal && c.commitments.length)

async function call(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: Record<string, unknown>, message = t('manage.saved')) {
  busy.value = true
  try {
    await $fetch(`/api/manage/${path}`, { method, body })
    toast.add({ title: message, color: 'success', icon: 'i-lucide-check' })
    await refreshNuxtData(`view:${route.path}`)
  } catch {
    toast.add({ title: t('errors.generic'), color: 'error' })
  } finally {
    busy.value = false
  }
}

const add = (campaignId: string, input: CommitmentInput) => call('commitments', 'POST', { ...input, campaign: campaignId })
const update = (id: string, input: CommitmentInput) => call(`commitments/${id}`, 'PATCH', { ...input })
const pause = (id: string, paused: boolean) => call(`commitments/${id}`, 'PATCH', { paused })
const remove = (id: string) => call(`commitments/${id}`, 'DELETE', undefined, t('manage.removed'))
const saveProfile = () => call('profile', 'POST', { ...profile })
const setConsent = (purpose: string, grant: boolean) => call('consent', 'POST', { purpose, grant })
const setStatus = (status: 'active' | 'unsubscribed') => call('status', 'POST', { status }, status === 'unsubscribed' ? t('manage.unsubscribed') : t('manage.resubscribed'))

async function deleteData() {
  busy.value = true
  try {
    await $fetch('/api/manage/delete', { method: 'POST' })
    await navigateTo(link('notice', ['deleted'], { current: true }))
  } catch {
    toast.add({ title: t('errors.generic'), color: 'error' })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-10 space-y-10">
    <h1 class="text-3xl font-bold">{{ t('manage.title') }}</h1>

    <div v-if="!manage" class="space-y-4">
      <p class="text-stone-700">{{ t('manage.signed_out') }}</p>
      <UButton :href="site.myUrl" external :label="t('footer.my')" />
    </div>

    <template v-else>
      <p class="text-stone-700">{{ t('manage.intro', { email: manage.email ?? '', site: site.name }) }}</p>
      <UAlert v-if="!manage.verified" color="warning" variant="soft" icon="i-lucide-mail" :title="t('manage.unverified')" />
      <UAlert
        v-if="manage.status === 'unsubscribed'"
        color="neutral"
        variant="soft"
        icon="i-lucide-bell-off"
        :title="t('manage.status_unsubscribed')"
        :actions="[{ label: t('manage.resubscribe'), onClick: () => setStatus('active') }]"
      />
      <UAlert v-else-if="manage.status === 'inactive'" color="warning" variant="soft" :title="t('manage.status_inactive')" :actions="[{ label: t('manage.resubscribe'), onClick: () => setStatus('active') }]" />

      <section aria-labelledby="times-title" class="space-y-4">
        <h2 id="times-title" class="text-xl font-semibold">{{ t('manage.times') }}</h2>
        <p v-if="!manage.campaigns.length" class="text-stone-600">{{ t('manage.no_times') }}</p>
        <section v-for="c in manage.campaigns" :key="c.id" :aria-labelledby="`campaign-${c.id}`" class="space-y-3">
          <h3 :id="`campaign-${c.id}`" class="font-semibold">{{ c.name }}</h3>
          <CommitmentList
            :commitments="c.commitments"
            :duration-rule="c.durationRule"
            :durations="c.durations"
            :default-duration="c.defaultDuration"
            :can-add="canAdd(c)"
            :lang="site.lang"
            ics-base="/api/manage/commitments"
            :busy="busy"
            @add="(input: CommitmentInput) => add(c.id, input)"
            @update="update"
            @pause="pause"
            @remove="remove"
          />
        </section>
        <p class="text-sm">
          <UButton variant="link" icon="i-lucide-calendar-sync" :href="manage.icsUrl" external :label="t('manage.subscribe_calendar')" />
        </p>
      </section>

      <section aria-labelledby="profile-title" class="space-y-4">
        <h2 id="profile-title" class="text-xl font-semibold">{{ t('manage.profile') }}</h2>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="t('signup.name')" name="m-name">
            <UInput v-model="profile.name" autocomplete="name" class="w-full" />
          </UFormField>
          <UFormField v-if="languageItems.length > 1" :label="t('signup.language')" name="m-language">
            <USelect v-model="profile.language" :items="languageItems" class="w-full" />
          </UFormField>
          <UFormField :label="t('signup.timezone')" name="m-timezone" :help="t('manage.timezone_help')">
            <USelectMenu v-model="profile.timezone" :items="tzItems" class="w-full" />
          </UFormField>
        </div>
        <UButton :loading="busy" :label="t('common.save')" @click="saveProfile" />
      </section>

      <section aria-labelledby="consent-title" class="space-y-3">
        <h2 id="consent-title" class="text-xl font-semibold">{{ t('manage.email_prefs') }}</h2>
        <USwitch
          v-for="c in manage.consents"
          :key="c.key"
          :model-value="c.granted"
          :label="c.label || t('consent.site_updates', { site: site.name })"
          @update:model-value="v => setConsent(c.key, !!v)"
        />
        <p class="text-xs text-stone-500">{{ t('manage.reminders_separate') }}</p>
      </section>

      <section aria-labelledby="data-title" class="space-y-3">
        <h2 id="data-title" class="text-xl font-semibold">{{ t('manage.your_data') }}</h2>
        <div class="flex flex-wrap gap-2">
          <UButton variant="outline" icon="i-lucide-download" href="/api/manage/export" external :label="t('manage.download')" />
          <UButton v-if="manage.status !== 'unsubscribed'" variant="outline" color="neutral" icon="i-lucide-bell-off" :label="t('manage.unsubscribe')" @click="setStatus('unsubscribed')" />
          <UButton variant="outline" color="error" icon="i-lucide-trash-2" :label="t('manage.delete')" @click="confirmDelete = true" />
        </div>
      </section>

      <UModal v-model:open="confirmDelete" :title="t('manage.delete_confirm_title')" :description="t('manage.delete_confirm_body', { site: site.name })">
        <template #footer>
          <UButton color="error" :loading="busy" :label="t('manage.delete_confirm')" @click="deleteData" />
          <UButton variant="ghost" color="neutral" :label="t('common.cancel')" @click="confirmDelete = false" />
        </template>
      </UModal>

      <p class="text-sm border-t border-stone-200 pt-6">
        {{ t('manage.all_campaigns') }} <a :href="site.myUrl" class="underline">{{ t('footer.my') }}</a>
      </p>
    </template>
  </div>
</template>
