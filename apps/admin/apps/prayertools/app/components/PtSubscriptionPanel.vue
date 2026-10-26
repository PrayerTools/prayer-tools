<script setup lang="ts">
// Shown on CRM contact pages (registered in the pt-crm-panels plugin): the
// contact's subscription on this site, prayer times, activity, prayer totals
// and check-ins. Renders nothing outside a site, without pt.intercessors.read, or
// for a contact with no subscription.
const props = defineProps<{ recordId: string, recordType?: string }>()

const { data: site, can, slug } = usePtSite()
const { data: meta } = usePtMeta()
const toast = usePtToast()
const allowed = computed(() => !!site.value && can('pt.intercessors.read'))
const { data, refresh } = useAsyncData<Record<string, any> | null>(
  () => `pt-contact-subscription-${props.recordId}`,
  () => allowed.value ? $fetch(`/api/pt/contacts/${props.recordId}/subscription`) : Promise.resolve(null),
  { watch: [allowed, () => props.recordId] }
)
const { data: campaigns, execute: loadCampaigns } = useFetch<{ campaigns: { id: string, name: string, goal: string, track_time: boolean }[] }>('/api/pt/campaigns', { key: 'pt-campaigns', immediate: false })
const subId = computed(() => data.value?.subscription?.id as string | undefined)

async function patch(body: Record<string, unknown>, message = 'Saved') {
  try {
    await $fetch(`/api/pt/intercessors/${subId.value}`, { method: 'PATCH', body })
    await refresh()
    toast.ok(message)
  } catch (err) {
    toast.fail(err)
  }
}

// Personal-start campaigns: "Day 7 of 30 · last moved Oct 21".
function progress(c: Record<string, any>): string | null {
  if (c.start_mode !== 'join') return null
  const done = Number(c.entries_done)
  const day = c.entries && done >= c.entries ? `Finished all ${c.entries} entries` : `Day ${done + 1}${c.entries ? ` of ${c.entries}` : ''}`
  return c.advanced_on ? `${day} · last moved ${ptFormatDate(c.advanced_on)}` : day
}

function describe(c: Record<string, any>): string {
  const when = c.kind === 'dates'
    ? `${c.dates.length} date${c.dates.length === 1 ? '' : 's'}`
    : c.frequency === 'daily' ? 'Every day' : `Every ${c.days_of_week.map((d: number) => PT_LABELS.weekday[d]).join(', ')}`
  return `${when} at ${c.time} (${c.timezone})${c.duration_min ? ` · ${c.duration_min} min` : ''}`
}

const add = reactive({ open: false, campaignId: '', frequency: 'daily', days: [] as number[], time: '07:00', duration: 15 })
async function openAdd() {
  if (!campaigns.value) await loadCampaigns()
  add.campaignId = campaigns.value?.campaigns[0]?.id ?? ''
  add.open = true
}
async function addCommitment() {
  try {
    await $fetch(`/api/pt/intercessors/${subId.value}/commitments`, {
      method: 'POST',
      body: { campaignId: add.campaignId, frequency: add.frequency, days_of_week: add.days, time: add.time, duration_min: add.duration }
    })
    add.open = false
    await refresh()
  } catch (err) {
    toast.fail(err)
  }
}
async function togglePause(c: Record<string, any>) {
  await $fetch(`/api/pt/intercessors/${subId.value}/commitments/${c.id}`, { method: 'PATCH', body: { paused: !c.paused } }).catch(err => toast.fail(err))
  await refresh()
}
async function removeCommitment(c: Record<string, any>) {
  await $fetch(`/api/pt/intercessors/${subId.value}/commitments/${c.id}`, { method: 'DELETE' }).catch(err => toast.fail(err))
  await refresh()
}
async function sendCheckin() {
  try {
    await $fetch(`/api/pt/intercessors/${subId.value}/checkin`, { method: 'POST' })
    toast.ok('Check-in email queued')
  } catch (err) {
    toast.fail(err)
  }
}
const confirmDelete = ref(false)
async function remove() {
  await $fetch(`/api/pt/intercessors/${subId.value}`, { method: 'DELETE' })
  await navigateTo(`/@${slug.value}/crm/contacts`)
}
</script>

<template>
  <section
    v-if="data?.subscription && site"
    class="space-y-2"
  >
    <div class="flex items-center gap-2 px-1">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
        Prayer
      </h2>
      <UBadge
        :label="PT_LABELS.subscriptionStatus[data.subscription.status]"
        :color="ptStatusColor(data.subscription.status)"
        size="sm"
        variant="subtle"
      />
      <UBadge
        v-if="!data.subscription.verified_at"
        size="sm"
        color="warning"
        variant="soft"
        label="Email not confirmed"
      />
    </div>

    <div class="border border-(--ui-border) rounded-lg divide-y divide-(--ui-border) bg-(--ui-bg)">
      <div class="px-4 py-3 space-y-3">
        <p class="text-sm text-(--ui-text-muted)">
          Signed up {{ ptFormatDate(data.subscription.created_at) }}
          · reminders by {{ data.subscription.delivery === 'app' ? 'app' : 'email' }}
          <span v-if="data.subscription.last_activity_at"> · last prayed {{ ptFormatDate(data.subscription.last_activity_at) }}</span>
          <span v-if="data.subscription.referred_by"> · joined through a share link</span>
        </p>
        <div class="flex flex-wrap gap-3">
          <UFormField label="Status">
            <USelect
              :model-value="data.subscription.status"
              :items="Object.entries(PT_LABELS.subscriptionStatus).map(([value, label]) => ({ value, label }))"
              :disabled="!can('pt.intercessors.write')"
              class="w-44"
              @update:model-value="(v) => patch({ status: v })"
            />
          </UFormField>
          <UFormField label="Language">
            <USelect
              :model-value="data.subscription.language"
              :items="site.site.languages.map(l => ({ value: l, label: languageName(meta, l) }))"
              :disabled="!can('pt.intercessors.write')"
              class="w-44"
              @update:model-value="(v) => patch({ language: v })"
            />
          </UFormField>
          <UFormField label="Timezone">
            <USelectMenu
              :model-value="data.subscription.timezone"
              :items="ptTimezones()"
              :disabled="!can('pt.intercessors.write')"
              class="w-64"
              @update:model-value="(v) => patch({ timezone: v })"
            />
          </UFormField>
        </div>
      </div>

      <div class="px-4 py-3">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-medium">
            Prayer times
          </h3>
          <UButton
            v-if="can('pt.intercessors.write')"
            size="xs"
            variant="ghost"
            icon="i-lucide-plus"
            label="Add"
            @click="openAdd"
          />
        </div>
        <ul class="divide-y divide-(--ui-border)">
          <li
            v-for="c in data.commitments"
            :key="c.id"
            class="py-2 flex flex-wrap items-center justify-between gap-2 text-sm"
          >
            <div>
              <p class="font-medium">
                {{ c.campaign_name }}
              </p>
              <p class="text-(--ui-text-muted)">
                {{ describe(c) }}<span v-if="c.paused"> · paused</span>
              </p>
              <p
                v-if="progress(c)"
                class="text-xs text-(--ui-text-muted)"
              >
                {{ progress(c) }}
              </p>
              <p
                v-if="c.next_reminder_utc"
                class="text-xs text-(--ui-text-muted)"
              >
                Next reminder {{ ptFormatDate(c.next_reminder_utc, { dateStyle: 'medium', timeStyle: 'short' }) }}
              </p>
            </div>
            <div
              v-if="can('pt.intercessors.write')"
              class="flex gap-1"
            >
              <UButton
                size="xs"
                variant="ghost"
                :label="c.paused ? 'Resume' : 'Pause'"
                @click="togglePause(c)"
              />
              <UButton
                size="xs"
                variant="ghost"
                color="error"
                label="Remove"
                @click="removeCommitment(c)"
              />
            </div>
          </li>
          <li
            v-if="!data.commitments.length"
            class="py-2 text-sm text-(--ui-text-muted)"
          >
            No prayer times.
          </li>
        </ul>
      </div>

      <PtContactActivity :record-id="recordId" />

      <div class="px-4 py-3">
        <h3 class="text-sm font-medium mb-1">
          Prayer and check-ins
        </h3>
        <ul class="text-sm space-y-1">
          <li
            v-for="t in data.totals"
            :key="t.campaign_name"
          >
            {{ t.campaign_name }}: {{ t.prayers }} prayers, {{ Math.round(t.seconds / 60) }} minutes
          </li>
          <li
            v-for="(c, i) in data.checkins"
            :key="`c${i}`"
            class="text-(--ui-text-muted)"
          >
            {{ c.kind === 'reminder' ? 'Check-in reminder' : 'Check-in' }} sent {{ ptFormatDate(c.sent_at) }}<span v-if="c.response"> — answered “{{ c.response }}”</span>
          </li>
          <li
            v-if="!data.totals.length && !data.checkins.length"
            class="text-(--ui-text-muted)"
          >
            Nothing yet.
          </li>
        </ul>
        <div
          v-if="can('pt.intercessors.write')"
          class="mt-3 flex flex-wrap justify-between gap-2"
        >
          <UButton
            v-if="data.subscription.verified_at && data.subscription.status !== 'unsubscribed' && data.subscription.delivery === 'email'"
            size="sm"
            variant="soft"
            label="Send a check-in now"
            @click="sendCheckin"
          />
          <UButton
            class="ms-auto"
            size="sm"
            color="error"
            variant="ghost"
            icon="i-lucide-trash"
            label="Delete this person's data"
            @click="confirmDelete = true"
          />
        </div>
      </div>
    </div>

    <UModal
      v-model:open="add.open"
      title="Add a prayer time"
    >
      <template #body>
        <div class="space-y-3">
          <UFormField label="Campaign">
            <USelect
              v-model="add.campaignId"
              :items="(campaigns?.campaigns ?? []).map(c => ({ value: c.id, label: c.name }))"
              class="w-full"
            />
          </UFormField>
          <UFormField label="How often">
            <URadioGroup
              v-model="add.frequency"
              :items="[{ value: 'daily', label: 'Every day' }, { value: 'weekly', label: 'Selected days' }]"
              orientation="horizontal"
            />
          </UFormField>
          <UFormField
            v-if="add.frequency === 'weekly'"
            label="Days"
          >
            <UCheckboxGroup
              v-model="add.days"
              :items="PT_LABELS.weekday.map((label, value) => ({ label, value }))"
              orientation="horizontal"
            />
          </UFormField>
          <div class="flex gap-3">
            <UFormField label="Time (their timezone)">
              <UInput
                v-model="add.time"
                type="time"
              />
            </UFormField>
            <UFormField label="Minutes">
              <UInputNumber
                v-model="add.duration"
                :min="1"
                :max="1440"
              />
            </UFormField>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end w-full">
          <UButton
            label="Add"
            @click="addCommitment"
          />
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="confirmDelete"
      title="Delete this person's data?"
      description="Their subscription, prayer times and contact record on this site are deleted. This can't be undone."
    >
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="confirmDelete = false"
          />
          <UButton
            label="Delete"
            color="error"
            @click="remove"
          />
        </div>
      </template>
    </UModal>
  </section>
</template>
