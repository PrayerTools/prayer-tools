<script setup lang="ts">
import type { ManageCampaignView, ManageView } from '~~/shared/view'
import { languageFlag } from '@prayertools/shared/languages'
import { timezones, type CommitmentInput } from '~/utils/commitment'

const props = defineProps<{ manage: ManageView | null, signedInAs: string | null }>()
const { site, link, st, date } = useSite()
const { t } = useI18n()
const route = useRoute()
const toast = useToast()
useHead({ title: () => `${t('manage.title')} · ${site.value.name}` })

const busy = ref(false)
const confirmDelete = ref(false)
const leaveOpen = ref(false)
const leaving = ref<{ id: string, name: string } | null>(null)
const profile = reactive({ name: props.manage?.name ?? '', language: props.manage?.language ?? site.value.lang, timezone: props.manage?.timezone ?? 'UTC' })
const tzItems = timezones()
const signupOpen = computed(() => site.value.status !== 'archived' && (site.value.campaign?.state === 'active' || site.value.campaign?.state === 'upcoming'))
const languageItems = computed(() => site.value.languages.map(l => ({ label: l.native, value: l.code, icon: languageFlag(l.code) })))
const confirmed = computed(() => route.query.confirmed === '1')
const sharePrompt = ref(false)
const prayNote = computed(() => site.value.campaign?.state === 'upcoming' && site.value.campaign.startDate ? t('landing.starts_on', { date: date(site.value.campaign.startDate) }) : t('landing.pray_today'))
const showPray = computed(() => site.value.status !== 'archived' && (site.value.campaign?.state === 'active' || site.value.campaign?.state === 'upcoming'))
const campaigns = computed(() => [...(props.manage?.campaigns ?? [])].sort((a, b) => Number(a.state === 'ended') - Number(b.state === 'ended')))

onMounted(() => {
  if (confirmed.value && site.value.settings.sharePrompts) setTimeout(() => (sharePrompt.value = true), 1200)
  dropQueryParams('confirmed')
})
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
const saveProfile = () => call('profile', 'POST', props.manage?.accountLinked ? { language: profile.language, timezone: profile.timezone } : { ...profile })
const setConsent = (purpose: string, grant: boolean) => call('consent', 'POST', { purpose, grant })
const setStatus = (status: 'active' | 'unsubscribed') => call('status', 'POST', { status }, status === 'unsubscribed' ? t('manage.unsubscribed') : t('manage.resubscribed'))

function askLeave(c: ManageCampaignView) {
  leaving.value = { id: c.id, name: c.name }
  leaveOpen.value = true
}

async function leave() {
  if (!leaving.value) return
  await call('leave', 'POST', { campaign: leaving.value.id }, t('manage.left', { campaign: leaving.value.name }))
  leaveOpen.value = false
}

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
  <div>
    <div class="border-b border-stone-200 bg-white">
      <div class="max-w-5xl mx-auto px-4 py-8 sm:py-10 space-y-5">
        <UAlert v-if="confirmed" color="success" variant="soft" icon="i-lucide-badge-check" :title="t('pray.confirmed_title')" :description="t('pray.confirmed_body')" role="status" />
        <div class="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div class="min-w-0 space-y-2">
            <h1 class="text-3xl sm:text-4xl font-bold tracking-tight text-balance">{{ t('manage.title') }}</h1>
            <p v-if="manage" class="text-stone-600">{{ t('manage.intro', { email: manage.email ?? '', site: site.name }) }}</p>
          </div>
          <div v-if="showPray" class="flex flex-col items-start gap-1.5 sm:items-end">
            <UButton :to="link('pray')" size="lg" icon="i-lucide-book-open" trailing-icon="i-lucide-arrow-right" :ui="{ trailingIcon: 'rtl:rotate-180' }" :label="t('nav.pray')" />
            <span class="text-sm text-stone-600">{{ prayNote }}</span>
          </div>
        </div>
        <div class="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <NuxtLink :to="link()" class="inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline">
            <UIcon name="i-lucide-house" class="size-4 shrink-0" />{{ site.campaign?.name ?? site.name }} · {{ t('manage.home_link') }}
          </NuxtLink>
          <a v-if="manage" :href="manage.icsUrl" class="inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline">
            <UIcon name="i-lucide-calendar-plus" class="size-4 shrink-0" />{{ t('manage.subscribe_calendar') }}
          </a>
        </div>
      </div>
    </div>

    <div v-if="!manage" class="max-w-5xl mx-auto px-4 py-8 sm:py-10">
      <div class="max-w-2xl rounded-xl border border-stone-200 bg-white p-5 sm:p-6 space-y-4">
        <p class="text-stone-700">{{ signedInAs ? t('manage.signed_in_empty', { email: signedInAs, site: site.name }) : t('manage.signed_out') }}</p>
        <div class="flex flex-wrap gap-2">
          <UButton v-if="signedInAs && signupOpen" :to="link('signup')" :label="st('landing.signup.title')" />
          <UButton :href="site.myUrl" external :variant="signedInAs && signupOpen ? 'outline' : 'solid'" :label="t('footer.my')" />
        </div>
      </div>
    </div>

    <div v-else class="max-w-5xl mx-auto px-4 py-8 sm:py-10 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-labelledby="times-title" class="space-y-6">
        <h2 id="times-title" class="sr-only">{{ t('manage.times') }}</h2>
        <div v-if="!manage.verified || manage.status !== 'active'" class="space-y-3">
          <UAlert v-if="!manage.verified" color="warning" variant="soft" icon="i-lucide-mail" :title="t('manage.unverified')" />
          <UAlert
            v-if="manage.status === 'unsubscribed'"
            color="neutral"
            variant="soft"
            icon="i-lucide-bell-off"
            :title="t('manage.status_unsubscribed')"
            :actions="[{ label: t('manage.resubscribe'), onClick: () => setStatus('active') }]"
          />
          <UAlert v-else-if="manage.status === 'inactive'" color="warning" variant="soft" icon="i-lucide-bell-off" :title="t('manage.status_inactive')" :actions="[{ label: t('manage.resubscribe'), onClick: () => setStatus('active') }]" />
        </div>
        <p v-if="!campaigns.length" class="rounded-xl border border-stone-200 bg-white p-5 text-stone-600">{{ t('manage.no_times') }}</p>
        <SectionCard v-for="c in campaigns" :key="c.id" :title="c.name" :title-id="`campaign-${c.id}`" :level="3" :muted="c.state === 'ended'">
          <template v-if="c.state === 'ended'" #badge>
            <UBadge color="neutral" variant="soft" size="sm" :label="t('manage.ended')" />
          </template>
          <CommitmentList
            :commitments="c.commitments"
            :cadence="c.cadence"
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
          >
            <template v-if="c.state !== 'ended' && c.commitments.length" #end>
              <UButton size="sm" variant="link" color="neutral" icon="i-lucide-log-out" :label="t('manage.leave', { campaign: c.name })" @click="askLeave(c)" />
            </template>
          </CommitmentList>
        </SectionCard>
      </section>

      <aside class="space-y-6">
        <SectionCard :title="t('manage.profile')" title-id="profile-title">
          <div class="space-y-5 py-5">
            <UFormField :label="t('signup.name')" name="m-name">
              <UInput v-model="profile.name" autocomplete="name" :disabled="manage.accountLinked" class="w-full" />
              <template v-if="manage.accountLinked" #help>
                {{ t('manage.name_on_my') }} <a :href="site.myUrl" class="underline">{{ t('footer.my') }}</a>
              </template>
            </UFormField>
            <UFormField v-if="languageItems.length > 1" :label="t('signup.language')" name="m-language">
              <USelect v-model="profile.language" :items="languageItems" :icon="languageFlag(profile.language)" class="w-full" />
            </UFormField>
            <UFormField :label="t('signup.timezone')" name="m-timezone" :help="t('manage.timezone_help')">
              <USelectMenu v-model="profile.timezone" :items="tzItems" class="w-full" />
            </UFormField>
          </div>
          <template #footer>
            <UButton :loading="busy" :label="t('common.save')" @click="saveProfile" />
          </template>
        </SectionCard>

        <SectionCard :title="t('manage.email_prefs')" title-id="consent-title">
          <div class="space-y-3 py-5">
            <USwitch
              v-for="c in manage.consents"
              :key="c.key"
              :model-value="c.granted"
              :label="c.label || t('consent.site_updates', { site: site.name })"
              @update:model-value="v => setConsent(c.key, !!v)"
            />
            <p class="text-sm text-stone-600">{{ t('manage.reminders_separate') }}</p>
          </div>
        </SectionCard>

        <SectionCard :title="t('manage.your_data')" title-id="data-title">
          <div class="flex flex-col items-start gap-1 py-4">
            <UButton variant="ghost" color="neutral" icon="i-lucide-download" href="/api/manage/export" external class="-ms-2.5" :label="t('manage.download')" />
            <UButton v-if="manage.status !== 'unsubscribed'" variant="ghost" color="neutral" icon="i-lucide-bell-off" class="-ms-2.5" :label="t('manage.unsubscribe')" @click="setStatus('unsubscribed')" />
            <UButton variant="ghost" color="error" icon="i-lucide-trash-2" class="-ms-2.5" :label="t('manage.delete')" @click="confirmDelete = true" />
          </div>
        </SectionCard>

        <p class="px-1 text-sm text-stone-600">
          {{ t('manage.all_campaigns') }} <a :href="site.myUrl" class="font-medium underline underline-offset-4">{{ t('footer.my') }}</a>
        </p>
      </aside>

      <UModal v-model:open="leaveOpen" :title="t('manage.leave_confirm_title', { campaign: leaving?.name ?? '' })" :description="t('manage.leave_confirm_body', { campaign: leaving?.name ?? '', site: site.name })">
        <template #footer>
          <UButton color="error" :loading="busy" :label="t('manage.leave', { campaign: leaving?.name ?? '' })" @click="leave" />
          <UButton variant="ghost" color="neutral" :label="t('common.cancel')" @click="leaveOpen = false" />
        </template>
      </UModal>

      <UModal v-model:open="confirmDelete" :title="t('manage.delete_confirm_title')" :description="t('manage.delete_confirm_body', { site: site.name })">
        <template #footer>
          <UButton color="error" :loading="busy" :label="t('manage.delete_confirm')" @click="deleteData" />
          <UButton variant="ghost" color="neutral" :label="t('common.cancel')" @click="confirmDelete = false" />
        </template>
      </UModal>
    </div>
    <SharePrompt v-model:open="sharePrompt" :title="t('share.prompt_title')" :description="t('share.prompt_body')" />
  </div>
</template>
