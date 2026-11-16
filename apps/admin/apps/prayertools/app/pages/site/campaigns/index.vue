<script setup lang="ts">
// The site's campaigns, grouped by state, each with its dates, setup answers,
// people and prayer times, and the actions that fit its state.
import { emailT } from '@prayertools/shared/i18n/email'
import { textIn } from '@prayertools/shared/translatable'
import type { PtCampaign } from '../../../utils/pt-campaign-ui'

definePageMeta({ middleware: 'auth' })

const { data: site, can, refresh: refreshSite } = usePtSite()
const toast = usePtToast()
const { data, status, refresh } = usePtCampaignList()
const canEdit = computed(() => can('pt.campaigns.write'))

const groups = computed(() => {
  const list = data.value?.campaigns ?? []
  return (['active', 'upcoming', 'ended'] as const)
    .map(state => ({ state, items: list.filter(c => c.status === state) }))
    .filter(g => g.items.length)
})
// A running main campaign with no end date holds every future date, so only a side campaign fits until it is ended.
const blocker = computed(() => data.value?.campaigns.find(c => c.kind !== 'side' && c.status === 'active' && c.end_mode !== 'date') ?? null)
const blockedOpen = ref(false)
const serving = (c: PtCampaign) => site.value?.currentCampaign?.id === c.id
const resultsUrl = (c: PtCampaign) => site.value ? `${site.value.url}/${c.slug}/stats` : undefined

const expanded = ref<string | null>(null)

const confirm = reactive({ open: false, campaign: null as PtCampaign | null })
function askDelete(c: PtCampaign) {
  Object.assign(confirm, { open: true, campaign: c })
}
const confirming = ref(false)
async function doConfirm() {
  if (!confirm.campaign) return
  confirming.value = true
  try {
    await $fetch(`/api/pt/campaigns/${confirm.campaign.id}`, { method: 'DELETE' })
    toast.ok('Campaign deleted')
    confirm.open = false
    await refresh()
  } catch (err) {
    toast.fail(err, 'Could not delete the campaign')
  } finally {
    confirming.value = false
  }
}

// Ending a running campaign. The confirmation shows the thank-you, or asks for
// its missing parts; what is edited there is saved by the request that ends it.
const canEnd = (c: PtCampaign) => canEdit.value && !!c.published_at && c.status === 'active'
const ending = reactive({ open: false, campaign: null as PtCampaign | null, editing: false, busy: false })
const endPreview = ref<{ sends: boolean, recipients: number } | null>(null)
const thankYouEditor = useTemplateRef<{ values: () => Record<string, unknown>, incomplete: boolean }>('thankYouEditor')
const defaultLanguage = computed(() => site.value?.site.default_language ?? 'en')
const messageOf = (c: PtCampaign) => textIn(c.end_message, defaultLanguage.value)
// The button is settled once the champion wrote their own or chose to have none.
function buttonOf(c: PtCampaign) {
  if (c.cta?.mode === 'none') return { none: true as const }
  return c.cta?.url ? { none: false as const, label: textIn(c.cta.label, defaultLanguage.value), url: c.cta.url } : null
}
const endMessage = computed(() => ending.campaign ? messageOf(ending.campaign) : '')
const endButton = computed(() => ending.campaign ? buttonOf(ending.campaign) : null)
const endStandardText = computed(() => ending.campaign ? emailT(defaultLanguage.value, 'thanks.body', { campaign: ending.campaign.name }) : '')
const endMissing = computed(() => {
  if (endMessage.value && endButton.value) return ''
  const both = !endMessage.value && !endButton.value
  const what = both ? 'no message of its own and no button' : !endMessage.value ? 'no message of its own' : 'no button'
  const side = ending.campaign?.kind === 'side' && !endButton.value ? ' Without a button of your own, the email invites people to your main campaign.' : ''
  return `This campaign has ${what} yet. Add ${both ? 'them' : 'one'} here, or end it without.${side}`
})
const endRecipients = computed(() => {
  const p = endPreview.value
  if (!p) return 'The people who took part get the thank-you email.'
  if (!p.sends) return 'No thank-you email is sent, because your site is not published.'
  if (!p.recipients) return 'No thank-you email is sent: nobody with a confirmed email took part.'
  return p.recipients === 1 ? '1 person who took part gets the thank-you email.' : `${p.recipients.toLocaleString()} people who took part get the thank-you email.`
})
async function askEnd(c: PtCampaign) {
  Object.assign(ending, { open: true, campaign: c, editing: !messageOf(c) || !buttonOf(c), busy: false })
  endPreview.value = null
  const preview = await $fetch<{ sends: boolean, recipients: number }>(`/api/pt/campaigns/${c.id}/end`).catch(() => null)
  if (ending.campaign?.id === c.id) endPreview.value = preview
}
async function doEnd() {
  const c = ending.campaign
  if (!c) return
  const editor = ending.editing ? thankYouEditor.value : null
  if (editor?.incomplete) {
    toast.fail(new Error('Give your button a text and a link, or choose another option.'), 'Could not end the campaign')
    return
  }
  ending.busy = true
  try {
    const res = await $fetch<{ thankYou: boolean }>(`/api/pt/campaigns/${c.id}/end`, { method: 'POST', body: editor ? editor.values() : {} })
    toast.ok(`${c.name} has ended`, res.thankYou ? 'The thank-you emails are on their way.' : undefined)
    ending.open = false
    await Promise.all([refresh(), refreshSite()])
  } catch (err) {
    toast.fail(err, 'Could not end the campaign')
  } finally {
    ending.busy = false
  }
}
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6">
    <header class="theme-page-header rounded-lg flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-2xl font-bold">
          Campaigns
        </h1>
        <p class="text-sm text-muted max-w-xl">
          A campaign is one round of prayer on your site, like Ramadan 2026. Each has its own dates and setup.
          A site runs one main campaign at a time, so main campaign dates can't overlap.
          A side campaign, like Ramadan beside an ongoing campaign, runs alongside it at its own address with its own landing page.
          Relaunching creates a new campaign on the same site; past campaigns stay online with their results.
        </p>
      </div>
      <UButton
        v-if="canEdit"
        :to="blocker ? undefined : '/site/campaigns/new'"
        icon="i-lucide-plus"
        :label="data?.campaigns.length ? 'New campaign' : 'Create the first campaign'"
        @click="blockedOpen = !!blocker"
      />
    </header>

    <div
      v-if="status === 'pending' && !data"
      class="space-y-3"
    >
      <USkeleton class="h-32" />
      <USkeleton class="h-32" />
    </div>

    <UCard v-else-if="!data?.campaigns.length">
      <p class="text-sm text-muted">
        No campaigns yet. Create one to set its dates, goal and how often there is new prayer content.
      </p>
    </UCard>

    <section
      v-for="g in groups"
      :key="g.state"
      class="space-y-3"
    >
      <h2 class="text-sm font-semibold text-muted uppercase tracking-wide">
        {{ PT_LABELS.campaignStatus[g.state] }}
      </h2>
      <UCard
        v-for="c in g.items"
        :key="c.id"
      >
        <div class="space-y-3">
          <div class="flex items-start justify-between gap-3 flex-wrap">
            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <NuxtLink
                  :to="`/site/campaigns/${c.id}`"
                  class="font-semibold hover:underline"
                >
                  {{ c.name }}
                </NuxtLink>
                <UBadge
                  v-if="!c.published_at"
                  color="neutral"
                  variant="subtle"
                  label="Draft"
                />
                <UBadge
                  v-else
                  :color="ptStatusColor(c.status)"
                  variant="subtle"
                  :label="PT_LABELS.campaignStatus[c.status]"
                />
                <UBadge
                  v-if="serving(c)"
                  color="primary"
                  variant="outline"
                  label="On the site now"
                />
                <UBadge
                  v-if="c.kind === 'side'"
                  color="neutral"
                  variant="outline"
                  label="Side campaign"
                />
              </div>
              <p class="text-sm text-muted">
                {{ ptCampaignDates(c) }} · <span class="font-mono">/{{ c.slug }}</span>
              </p>
              <p class="text-xs text-muted mt-1">
                {{ ptAnswersLine(c) }}
              </p>
            </div>
            <div class="text-sm sm:text-end space-y-1">
              <div>
                <span class="font-semibold">{{ c.progress.people.toLocaleString() }}</span>
                {{ c.progress.people === 1 ? 'person' : 'people' }}
              </div>
              <div class="text-muted">
                {{ ptPlural(c.commitments, 'prayer time', 'prayer times') }}
              </div>
              <div
                v-if="c.progress.percent !== null && ptGoalText(c.progress)"
                class="w-48 space-y-1"
              >
                <UProgress
                  :model-value="Math.min(100, c.progress.percent)"
                  size="sm"
                />
                <p class="text-xs text-muted">
                  {{ ptGoalText(c.progress) }}
                </p>
              </div>
            </div>
          </div>
          <p
            v-if="c.status === 'ended' && c.waiting"
            class="text-sm flex items-center gap-1.5"
          >
            <UIcon
              name="i-lucide-bell"
              class="size-4 shrink-0 text-muted"
            />
            {{ c.waiting === 1 ? '1 person asked' : `${c.waiting.toLocaleString()} people asked` }} to hear when this runs again. Relaunching it tells them.
          </p>
          <div class="flex items-center gap-2 flex-wrap">
            <UButton
              v-if="canEdit && !c.published_at"
              :to="`/site/campaigns/setup/${c.id}`"
              size="sm"
              icon="i-lucide-list-checks"
              label="Continue setup"
            />
            <UButton
              :to="`/site/campaigns/${c.id}`"
              size="sm"
              variant="outline"
              color="neutral"
              :icon="canEdit ? 'i-lucide-pencil' : 'i-lucide-eye'"
              :label="canEdit ? 'Edit' : 'Open'"
            />
            <UButton
              v-if="canEdit && c.status === 'ended' && (!blocker || c.kind === 'side')"
              :to="`/site/campaigns/new?relaunch=${c.id}`"
              size="sm"
              variant="outline"
              color="neutral"
              icon="i-lucide-rotate-ccw"
              label="Relaunch"
            />
            <UButton
              v-if="canEnd(c)"
              size="sm"
              variant="outline"
              color="error"
              icon="i-lucide-circle-stop"
              label="End campaign"
              @click="askEnd(c)"
            />
            <UButton
              v-if="canEdit && c.commitments === 0"
              size="sm"
              variant="ghost"
              color="error"
              icon="i-lucide-trash-2"
              label="Delete"
              @click="askDelete(c)"
            />
            <UButton
              :to="{ path: '/site/landing', query: { campaign: c.id } }"
              size="sm"
              variant="ghost"
              color="neutral"
              icon="i-lucide-panels-top-left"
              label="Landing page"
            />
            <UButton
              :to="{ path: '/site/stats', query: { campaign: c.id } }"
              size="sm"
              variant="ghost"
              color="neutral"
              icon="i-lucide-chart-line"
              label="Stats"
            />
            <UButton
              v-if="resultsUrl(c)"
              :to="resultsUrl(c)"
              target="_blank"
              size="sm"
              variant="ghost"
              color="neutral"
              icon="i-lucide-external-link"
              label="Public results"
            />
            <UButton
              size="sm"
              variant="soft"
              :icon="expanded === c.id ? 'i-lucide-chevron-up' : 'i-lucide-mail'"
              label="Thank-you message"
              @click="expanded = expanded === c.id ? null : c.id"
            />
          </div>
          <div
            v-if="expanded === c.id && site"
            class="border-t border-default pt-4"
          >
            <PtCampaignThankYou
              :campaign-id="c.id"
              :end-message="c.end_message"
              :cta="c.cta"
              :side="c.kind === 'side'"
              :languages="site.site.languages"
              :default-language="site.site.default_language"
              @saved="refresh"
            />
          </div>
        </div>
      </UCard>
    </section>

    <UModal
      v-if="blocker"
      v-model:open="blockedOpen"
      :title="`${blocker.name} has no end date`"
      description="A site runs one main campaign at a time, and this one keeps running until you end it with End campaign on its card here. Another campaign with fixed dates, like Ramadan, can run alongside it as a side campaign."
    >
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            color="neutral"
            variant="ghost"
            label="Cancel"
            @click="blockedOpen = false"
          />
          <UButton
            to="/orgs/new"
            color="neutral"
            variant="outline"
            label="Create a new site"
          />
          <UButton
            :to="{ path: '/site/campaigns/new', query: { kind: 'side' } }"
            icon="i-lucide-plus"
            label="New side campaign"
          />
        </div>
      </template>
    </UModal>

    <ConfirmModal
      v-model:open="ending.open"
      :title="`End ${ending.campaign?.name ?? 'this campaign'} now?`"
      confirm-label="End campaign"
      :loading="ending.busy"
      :ui="{ content: 'max-w-xl' }"
      @confirm="doEnd"
    >
      <div
        v-if="ending.campaign && site"
        class="space-y-4 text-sm"
      >
        <ul class="list-disc ps-5 space-y-1">
          <li>Prayer reminders stop and nobody new can sign up.</li>
          <li>{{ endRecipients }}</li>
          <li v-if="ending.campaign.start_mode === 'join'">
            People part-way through stop where they are. Those who already finished got their thank-you then.
          </li>
          <li>{{ ending.campaign.kind === 'side' ? 'Its page shows' : 'Your site shows' }} the final results in place of signup.</li>
          <li>This can't be undone.</li>
        </ul>
        <USeparator label="Thank-you email" />
        <p class="text-(--ui-text-muted)">
          Everyone is told “{{ endStandardText }}” and how much they prayed. Your own message and button follow.
        </p>
        <div
          v-if="!ending.editing"
          class="rounded-md border border-(--ui-border) bg-(--ui-bg-elevated)/50 p-4 space-y-2"
        >
          <p class="whitespace-pre-line">
            {{ endMessage }}
          </p>
          <p class="text-(--ui-text-muted)">
            <template v-if="endButton && !endButton.none">
              Button: {{ endButton.label }} ({{ endButton.url }})
            </template>
            <template v-else>
              No button.
            </template>
          </p>
          <UButton
            size="sm"
            variant="outline"
            color="neutral"
            icon="i-lucide-pencil"
            label="Change"
            @click="ending.editing = true"
          />
        </div>
        <template v-else>
          <p v-if="endMissing">
            {{ endMissing }}
          </p>
          <PtCampaignThankYou
            ref="thankYouEditor"
            :key="ending.campaign.id"
            embedded
            :campaign-id="ending.campaign.id"
            :end-message="ending.campaign.end_message"
            :cta="ending.campaign.cta"
            :side="ending.campaign.kind === 'side'"
            :languages="site.site.languages"
            :default-language="site.site.default_language"
          />
        </template>
      </div>
    </ConfirmModal>

    <UModal
      v-model:open="confirm.open"
      title="Delete this campaign?"
      description="Nobody has signed up for it yet. Its setup and thank-you message are deleted too."
    >
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            color="neutral"
            variant="ghost"
            label="Cancel"
            @click="confirm.open = false"
          />
          <UButton
            color="error"
            :loading="confirming"
            label="Delete campaign"
            @click="doConfirm"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
