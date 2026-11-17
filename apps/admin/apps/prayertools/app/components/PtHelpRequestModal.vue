<script setup lang="ts">
// Sends an inbox conversation to Prayer.Tools with a note, or shows the
// request already waiting for an answer. Closes with true once sent.
const props = defineProps<{ conversationId: string }>()
const emit = defineEmits<{ close: [sent: boolean] }>()

interface OpenRequest { id: string, note: string, created_at: string, requested_by_name: string | null }
const toast = usePtToast()
const loading = ref(true)
const open = ref<OpenRequest | null>(null)
const noteMax = ref(1000)
const note = ref('')
const sending = ref(false)

async function load() {
  loading.value = true
  try {
    const res = await $fetch<{ open: OpenRequest | null, noteMax: number }>('/api/pt/help-requests', { query: { conversationId: props.conversationId } })
    open.value = res.open
    noteMax.value = res.noteMax
  } catch (err) {
    toast.fail(err, 'Could not load')
    emit('close', false)
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function send() {
  if (!note.value.trim()) return
  sending.value = true
  try {
    await $fetch('/api/pt/help-requests', { method: 'POST', body: { conversationId: props.conversationId, note: note.value } })
    toast.ok('Sent to Prayer.Tools')
    emit('close', true)
  } catch (err) {
    toast.fail(err, 'Could not send')
    if ((err as { statusCode?: number }).statusCode === 409) await load()
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <UModal
    title="Ask Prayer.Tools for help"
    :dismissible="!sending"
    @update:open="(v: boolean) => { if (!v) emit('close', false) }"
  >
    <template #body>
      <div
        v-if="loading"
        class="flex justify-center py-6"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="size-5 animate-spin text-(--ui-text-muted)"
        />
      </div>
      <div
        v-else-if="open"
        class="space-y-3 text-sm"
      >
        <p>
          Sent to Prayer.Tools on {{ ptFormatDate(open.created_at, { dateStyle: 'medium', timeStyle: 'short' }) }}<span v-if="open.requested_by_name"> by {{ open.requested_by_name }}</span>. Prayer.Tools hasn't answered yet; their reply will show in this conversation's notes and activity.
        </p>
        <blockquote class="border-l-2 border-(--ui-border-accented) pl-3 text-(--ui-text-muted) whitespace-pre-line">
          {{ open.note }}
        </blockquote>
      </div>
      <form
        v-else
        id="pt-help-request-form"
        class="space-y-5"
        @submit.prevent="send"
      >
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-eye"
          description="Prayer.Tools staff will be able to read this conversation, including the person's message and their contact details."
        />
        <UFormField
          label="What do you need help with?"
          required
          :hint="`${note.length}/${noteMax}`"
        >
          <UTextarea
            v-model="note"
            :maxlength="noteMax"
            :rows="4"
            autoresize
            autofocus
            placeholder="e.g. They ask us to delete their data"
            class="w-full"
          />
        </UFormField>
      </form>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          :label="open ? 'Close' : 'Cancel'"
          color="neutral"
          variant="ghost"
          @click="emit('close', false)"
        />
        <UButton
          v-if="!loading && !open"
          type="submit"
          form="pt-help-request-form"
          label="Send to Prayer.Tools"
          icon="i-lucide-life-buoy"
          :loading="sending"
          :disabled="!note.trim()"
        />
      </div>
    </template>
  </UModal>
</template>
