<script setup lang="ts">
// A contact's recent prayer activity (emails sent, prayer pages opened, Amen
// pressed) on the subscription panel, with the full history in a slideover.
const props = defineProps<{ recordId: string }>()

interface ActivityEvent {
  type: 'email' | 'opened' | 'prayed'
  kind: string
  subject: string | null
  at: string
  campaign: string | null
  day: number | null
  seconds: number | null
}

const PREVIEW = 4
const PAGE = 50

const { data: recent } = useAsyncData(
  () => `pt-contact-activity-${props.recordId}`,
  () => $fetch<{ events: ActivityEvent[], more: boolean }>(`/api/pt/contacts/${props.recordId}/activity`, { query: { limit: PREVIEW } }),
  { watch: [() => props.recordId] }
)

const open = ref(false)
const all = ref<ActivityEvent[]>([])
const more = ref(false)
const loading = ref(false)

async function loadMore() {
  loading.value = true
  try {
    const res = await $fetch<{ events: ActivityEvent[], more: boolean }>(`/api/pt/contacts/${props.recordId}/activity`, { query: { limit: PAGE, offset: all.value.length } })
    all.value = [...all.value, ...res.events]
    more.value = res.more
  } finally {
    loading.value = false
  }
}

async function showAll() {
  all.value = []
  open.value = true
  await loadMore()
}

const ICONS = { email: 'i-lucide-mail', opened: 'i-lucide-book-open', prayed: 'i-lucide-heart-handshake' }

function title(e: ActivityEvent): string {
  if (e.type === 'email') return `${PT_LABELS.emailKind[e.kind] ?? 'Email'} sent`
  if (e.type === 'opened') return 'Opened the prayer page'
  return 'Pressed “Amen — I prayed”'
}

function details(e: ActivityEvent): string {
  const parts: string[] = []
  if (e.type === 'email' && e.subject) parts.push(e.subject)
  if (e.campaign) parts.push(e.campaign)
  if (e.day) parts.push(`day ${e.day}`)
  if (e.type === 'opened' && e.seconds) parts.push(`${Math.max(1, Math.round(e.seconds / 60))} min`)
  if (e.type !== 'email' && PT_LABELS.sessionSource[e.kind]) parts.push(PT_LABELS.sessionSource[e.kind]!)
  return parts.join(' · ')
}
</script>

<template>
  <div class="px-4 py-3">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-medium">
        Prayer activity
      </h3>
      <UButton
        v-if="recent?.more"
        size="xs"
        variant="ghost"
        label="See all"
        @click="showAll"
      />
    </div>
    <ul class="divide-y divide-(--ui-border)">
      <li
        v-for="(e, i) in recent?.events ?? []"
        :key="i"
        class="py-2 flex gap-3 text-sm"
      >
        <UIcon
          :name="ICONS[e.type]"
          class="size-4 mt-0.5 shrink-0 text-(--ui-text-muted)"
        />
        <div class="min-w-0 flex-1">
          <p>{{ title(e) }}</p>
          <p
            v-if="details(e)"
            class="text-xs text-(--ui-text-muted) truncate"
          >
            {{ details(e) }}
          </p>
        </div>
        <span class="text-xs text-(--ui-text-muted) shrink-0">{{ ptFormatDate(e.at, { dateStyle: 'medium', timeStyle: 'short' }) }}</span>
      </li>
      <li
        v-if="recent && !recent.events.length"
        class="py-2 text-sm text-(--ui-text-muted)"
      >
        Nothing yet.
      </li>
    </ul>

    <USlideover
      v-model:open="open"
      title="Prayer activity"
      description="Emails sent to this person, prayer pages they opened, and when they pressed Amen."
    >
      <template #body>
        <ul class="divide-y divide-(--ui-border)">
          <li
            v-for="(e, i) in all"
            :key="i"
            class="py-2 flex gap-3 text-sm"
          >
            <UIcon
              :name="ICONS[e.type]"
              class="size-4 mt-0.5 shrink-0 text-(--ui-text-muted)"
            />
            <div class="min-w-0 flex-1">
              <p>{{ title(e) }}</p>
              <p
                v-if="details(e)"
                class="text-xs text-(--ui-text-muted)"
              >
                {{ details(e) }}
              </p>
            </div>
            <span class="text-xs text-(--ui-text-muted) shrink-0">{{ ptFormatDate(e.at, { dateStyle: 'medium', timeStyle: 'short' }) }}</span>
          </li>
        </ul>
        <UButton
          v-if="more || loading"
          class="mt-3"
          size="sm"
          variant="soft"
          label="Load more"
          :loading="loading"
          @click="loadMore"
        />
      </template>
    </USlideover>
  </div>
</template>
