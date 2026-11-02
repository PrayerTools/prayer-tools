<script setup lang="ts">
// A campaign's end-of-campaign thank-you: the champion's optional message and
// a button pointing somewhere next, saved on their own.
import type { TranslatableText } from '@prayertools/shared/db/schema'

const props = defineProps<{
  campaignId: string
  endMessage: TranslatableText | null
  cta: { url?: string, label?: TranslatableText } | null
  languages: string[]
  defaultLanguage: string
}>()
const emit = defineEmits<{ saved: [] }>()

const { can } = usePtSite()
const toast = usePtToast()
const message = ref<TranslatableText | null>(props.endMessage)
const ctaLabel = ref<TranslatableText | null>(props.cta?.label ?? null)
const ctaUrl = ref(props.cta?.url ?? '')
const canEdit = computed(() => can('pt.messages.write') || can('pt.campaigns.write'))

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    await $fetch(`/api/pt/campaigns/${props.campaignId}`, {
      method: 'PATCH',
      body: { end_message: message.value, cta: ctaUrl.value ? { url: ctaUrl.value, label: ctaLabel.value } : {} }
    })
    toast.ok('Thank-you message saved')
    emit('saved')
  } catch (err) {
    toast.fail(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-5">
    <p class="text-sm text-muted">
      When this campaign ends, everyone in it gets a thank-you email (in personal-start campaigns, each person when
      they reach the last day). You can add a message and a button pointing somewhere next, like your next campaign.
    </p>
    <fieldset
      :disabled="!canEdit"
      class="space-y-4"
    >
      <PtTranslatableInput
        v-model="message"
        :languages="languages"
        :default-language="defaultLanguage"
        label="Your message (optional)"
        multiline
      />
      <div class="grid gap-4 sm:grid-cols-2">
        <PtTranslatableInput
          v-model="ctaLabel"
          :languages="languages"
          :default-language="defaultLanguage"
          label="Button text"
          placeholder="e.g. Join the 12-day campaign"
        />
        <UFormField
          label="Button link"
          description="Shown only when the button has text too."
        >
          <UInput
            v-model="ctaUrl"
            type="url"
            placeholder="https://"
            class="w-full"
          />
        </UFormField>
      </div>
    </fieldset>
    <div class="flex items-center gap-2 flex-wrap">
      <UButton
        v-if="canEdit"
        icon="i-lucide-check"
        label="Save message"
        :loading="saving"
        @click="save"
      />
      <UButton
        v-if="can('pt.email.send')"
        :to="{ path: '/marketing/test-emails', query: { campaign: campaignId } }"
        variant="outline"
        color="neutral"
        icon="i-lucide-mail-check"
        label="Preview the thank-you email"
      />
    </div>
  </div>
</template>
