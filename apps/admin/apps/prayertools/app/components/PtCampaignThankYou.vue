<script setup lang="ts">
// A campaign's end-of-campaign thank-you: the champion's optional message and
// a button pointing somewhere next, saved on their own (by the parent, through `values()`, when `embedded`).
import type { CampaignCta, TranslatableText } from '@prayertools/shared/db/schema'
import { emailT } from '@prayertools/shared/i18n/email'
import { getTemplate, handOnCampaign } from '@prayertools/shared/setup'

const props = defineProps<{
  campaignId: string
  endMessage: TranslatableText | null
  cta: CampaignCta | null
  side: boolean
  templateKey: string | null
  languages: string[]
  defaultLanguage: string
  embedded?: boolean
}>()
const emit = defineEmits<{ saved: [] }>()

const { data: site, can } = usePtSite()
const toast = usePtToast()
const message = ref<TranslatableText | null>(props.endMessage)
const ctaLabel = ref<TranslatableText | null>(props.cta?.label ?? null)
const ctaUrl = ref(props.cta?.url ?? '')
const canEdit = computed(() => can('pt.messages.write') || can('pt.campaigns.write'))

// Without its own button, a side campaign invites people to the main campaign
// and a crisis template's campaign to the campaign after it; that invitation
// lives in code and is never saved.
const handsOn = computed(() => getTemplate(props.templateKey).cta === 'next_campaign')
const invites = computed(() => props.side || handsOn.value)
type ButtonChoice = 'default' | 'own' | 'none'
const choice = ref<ButtonChoice>(props.cta?.mode === 'none' ? 'none' : props.cta?.url ? 'own' : 'default')
const choiceItems = computed<{ value: ButtonChoice, label: string }[]>(() => [
  { value: 'default', label: handsOn.value ? 'Invite them to your next campaign' : 'Invite them to your main campaign' },
  { value: 'own', label: 'Your own button' },
  { value: 'none', label: 'No button' }
])
const showOwn = computed(() => !invites.value || choice.value === 'own')
const { data: list } = usePtCampaignList({ immediate: invites.value })
const nextName = computed(() => {
  const campaigns = list.value?.campaigns ?? []
  const self = campaigns.find(c => c.id === props.campaignId)
  return self ? handOnCampaign(self, campaigns)?.name ?? null : null
})
const defaultLabel = computed(() => nextName.value ? emailT(props.defaultLanguage, 'thanks.keep_praying', { campaign: nextName.value }) : null)
const prayingNote = computed(() => nextName.value
  ? `People who already have prayer times in ${nextName.value} see “${emailT(props.defaultLanguage, 'thanks.still_praying', { campaign: nextName.value })}” instead. The button follows each person's language.`
  : '')
const noNext = computed(() => {
  if (!handsOn.value) return 'Your site has no upcoming or running main campaign right now, so no button is shown.'
  const main = props.side ? ', and your site has no upcoming or running main campaign' : ''
  return `No published campaign starts after this one yet${main}, so no button is shown. Once you publish the campaign that follows, the button invites people to it.`
})
const ownMissing = computed(() => invites.value && choice.value === 'own' && !(ctaUrl.value && Object.values(ctaLabel.value?.values ?? {}).some(Boolean)))

function ctaBody(): CampaignCta | Record<string, unknown> {
  if (invites.value && choice.value === 'none') return { mode: 'none' }
  if (invites.value && choice.value === 'default') return {}
  return ctaUrl.value ? { url: ctaUrl.value, label: ctaLabel.value } : {}
}

defineExpose({
  values: () => ({ end_message: message.value, cta: ctaBody() }),
  // "Your own button" is chosen but its text or link is missing.
  incomplete: ownMissing
})

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    await $fetch(`/api/pt/campaigns/${props.campaignId}`, {
      method: 'PATCH',
      body: { end_message: message.value, cta: ctaBody() }
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
    <p
      v-if="!embedded"
      class="text-sm text-muted"
    >
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
      <UFormField
        v-if="invites"
        label="Button under the message"
      >
        <URadioGroup
          v-model="choice"
          :items="choiceItems"
          orientation="horizontal"
        />
      </UFormField>
      <div
        v-if="invites && choice === 'default'"
        class="rounded-md border border-(--ui-border) bg-(--ui-bg-elevated)/50 p-4 space-y-2"
      >
        <template v-if="defaultLabel">
          <p class="text-xs text-(--ui-text-muted) flex items-center gap-1">
            Preview
            <InfoTip :text="prayingNote" />
          </p>
          <span
            class="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold"
            :style="{ background: site?.brand.color, color: site?.brand.textColor }"
          >
            {{ defaultLabel }}
            <UIcon
              name="i-lucide-arrow-right"
              class="size-4"
            />
          </span>
        </template>
        <p
          v-else
          class="text-sm text-(--ui-text-muted)"
        >
          {{ noNext }}
        </p>
      </div>
      <div
        v-if="showOwn"
        class="grid gap-4 sm:grid-cols-2"
      >
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
    <div
      v-if="!embedded"
      class="flex items-center gap-2 flex-wrap"
    >
      <UButton
        v-if="canEdit"
        icon="i-lucide-check"
        label="Save message"
        :loading="saving"
        :disabled="ownMissing"
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
