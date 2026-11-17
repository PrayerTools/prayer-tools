<script setup lang="ts">
// Inbox conversations site teams sent to Prayer.Tools. Operators read one
// through support access and mark it handled, with an optional reply.
definePageMeta({ layout: 'admin', middleware: ['auth', 'admin'] })

interface HelpRequest {
  id: string
  org_id: string
  conversation_id: string
  note: string
  created_at: string
  handled_at: string | null
  reply: string | null
  site_name: string
  site_slug: string
  subject: string | null
  asked_by: string | null
  handled_by: string | null
}
const { data, refresh } = useFetch<{ requests: HelpRequest[], replyMax: number }>('/api/pt/admin/help-requests', { key: 'pt-admin-help-requests' })
const toast = usePtToast()
const confirmAction = useConfirm()

async function openConversation(r: HelpRequest) {
  const ok = await confirmAction({
    title: `Open ${r.site_name} for support?`,
    description: 'You join the site\'s team as an owner so its inbox opens for you. This is logged.',
    confirmLabel: 'Open for support',
    color: 'primary'
  })
  if (!ok) return
  try {
    const res = await $fetch<{ slug: string }>(`/api/pt/admin/sites/${r.org_id}/support`, { method: 'POST' })
    await navigateTo(`/@${res.slug}/inbox/${r.conversation_id}`)
  } catch (err) {
    toast.fail(err)
  }
}

const handling = ref<HelpRequest | null>(null)
const reply = ref('')
const saving = ref(false)
function startHandle(r: HelpRequest) {
  reply.value = ''
  handling.value = r
}
async function markHandled() {
  if (!handling.value) return
  saving.value = true
  try {
    await $fetch(`/api/pt/admin/help-requests/${handling.value.id}`, { method: 'POST', body: { reply: reply.value } })
    toast.ok('Marked handled')
    handling.value = null
    await refresh()
  } catch (err) {
    toast.fail(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-2xl font-semibold">
      Help requests
    </h1>
    <p
      v-if="!data?.requests.length"
      class="text-sm text-(--ui-text-muted)"
    >
      No help requests.
    </p>
    <UCard
      v-for="r in data?.requests ?? []"
      :key="r.id"
    >
      <div class="flex flex-wrap items-start justify-between gap-3 text-sm">
        <div class="min-w-0 flex-1 space-y-1">
          <div class="flex flex-wrap items-center gap-2">
            <UBadge
              :label="r.handled_at ? 'Handled' : 'Open'"
              :color="r.handled_at ? 'neutral' : 'warning'"
              variant="subtle"
            />
            <p class="font-medium">
              {{ r.site_name }} <span class="text-(--ui-text-muted)">({{ r.site_slug }})</span>
            </p>
          </div>
          <p class="truncate">
            {{ r.subject || '(no subject)' }}
          </p>
          <p class="whitespace-pre-line">
            {{ r.note }}
          </p>
          <p class="text-xs text-(--ui-text-muted)">
            {{ r.asked_by ?? 'A former team member' }} · {{ ptFormatDate(r.created_at, { dateStyle: 'medium', timeStyle: 'short' }) }}<span v-if="r.handled_at"> · handled {{ ptFormatDate(r.handled_at) }}<span v-if="r.handled_by"> by {{ r.handled_by }}</span></span>
          </p>
          <p
            v-if="r.reply"
            class="text-(--ui-text-muted) whitespace-pre-line"
          >
            Reply: {{ r.reply }}
          </p>
        </div>
        <div class="flex gap-2">
          <UButton
            size="sm"
            variant="soft"
            label="Open conversation"
            @click="openConversation(r)"
          />
          <UButton
            v-if="!r.handled_at"
            size="sm"
            label="Mark handled"
            @click="startHandle(r)"
          />
        </div>
      </div>
    </UCard>
    <UModal
      :open="!!handling"
      title="Mark handled"
      :dismissible="!saving"
      @update:open="(v: boolean) => { if (!v) handling = null }"
    >
      <template #body>
        <form
          id="pt-help-handle-form"
          class="space-y-5"
          @submit.prevent="markHandled"
        >
          <UFormField :hint="`${reply.length}/${data?.replyMax ?? 2000}`">
            <template #label>
              Reply to {{ handling?.asked_by ?? 'the team' }} (optional) <InfoTip text="Shown in the conversation's notes and activity, and sent to the team member who asked. The person who wrote in never sees it." />
            </template>
            <UTextarea
              v-model="reply"
              :maxlength="data?.replyMax ?? 2000"
              :rows="4"
              autoresize
              class="w-full"
            />
          </UFormField>
        </form>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            :disabled="saving"
            @click="handling = null"
          />
          <UButton
            type="submit"
            form="pt-help-handle-form"
            label="Mark handled"
            :loading="saving"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
