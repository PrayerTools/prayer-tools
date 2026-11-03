<script setup lang="ts">
// A campaign's end-of-campaign thank-you: the champion's optional message and
// a button pointing somewhere next, saved on their own.
import type { CampaignCta, TranslatableText } from '@prayertools/shared/db/schema'
import { emailT } from '@prayertools/shared/i18n/email'

const props = defineProps<{
  campaignId: string
  endMessage: TranslatableText | null
  cta: CampaignCta | null
  side: boolean
  languages: string[]
  defaultLanguage: string
}>()
const emit = defineEmits<{ saved: [] }>()

const { data: site, can } = usePtSite()
const toast = usePtToast()
const message = ref<TranslatableText | null>(props.endMessage)
const ctaLabel = ref<TranslatableText | null>(props.cta?.label ?? null)
const ctaUrl = ref(props.cta?.url ?? '')
const canEdit = computed(() => can('pt.campaigns.write'))

// A side campaign without its own button invites people to the main campaign;
// that invitation lives in code and is never saved.
type ButtonChoice = 'default' | 'own' | 'none'
const choice = ref<ButtonChoice>(props.cta?.mode === 'none' ? 'none' : props.cta?.url ? 'own' : 'default')
const choiceItems: { value: ButtonChoice, label: string }[] = [
  { value: 'default', label: 'Invite them to your main campaign' },
  { value: 'own', label: 'Your own button' },
  { value: 'none', label: 'No button' }
]
const showOwn = computed(() => !props.side || choice.value === 'own')
const mainName = computed(() => {
  const c = site.value?.currentCampaign
  return c && c.state !== 'between' ? String(c.name) : null
})
const defaultLabel = computed(() => mainName.value ? emailT(props.defaultLanguage, 'thanks.keep_praying', { campaign: mainName.value }) : null)
const prayingNote = computed(() => mainName.value
  ? `People who already have prayer times in ${mainName.value} see “${emailT(props.defaultLanguage, 'thanks.still_praying', { campaign: mainName.value })}” instead. The button follows each person's language.`
  : '')
const ownMissing = computed(() => props.side && choice.value === 'own' && !(ctaUrl.value && Object.values(ctaLabel.value?.values ?? {}).some(Boolean)))

function ctaBody(): CampaignCta | Record<string, unknown> {
  if (props.side && choice.value === 'none') return { mode: 'none' }
  if (props.side && choice.value === 'default') return {}
  return ctaUrl.value ? { url: ctaUrl.value, label: ctaLabel.value } : {}
}

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
      <UFormField
        v-if="side"
        label="Button under the message"
      >
        <URadioGroup
          v-model="choice"
          :items="choiceItems"
          orientation="horizontal"
        />
      </UFormField>
      <div
        v-if="side && choice === 'default'"
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
          Your site has no upcoming or running main campaign right now, so no button is shown.
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
    <div class="flex items-center gap-2 flex-wrap">
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
