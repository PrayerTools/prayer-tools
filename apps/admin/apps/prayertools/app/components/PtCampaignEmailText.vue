<script setup lang="ts">
// A campaign's own words in its emails: a tagline under the welcome email's
// greeting, a note in the welcome email and a note in every prayer reminder.
// Each is optional; the notes are written per language.
import type { CampaignEmailText, TiptapDoc, TranslatableText } from '@prayertools/shared/db/schema'
import { languageFlag } from '@prayertools/shared/languages'
import { isEmptyDoc } from '@prayertools/shared/tiptap'

const props = defineProps<{
  campaignId: string
  emailText: CampaignEmailText | null
  languages: string[]
  defaultLanguage: string
}>()
const emit = defineEmits<{ saved: [] }>()

const { can } = usePtSite()
const { data: meta } = usePtMeta()
const toast = usePtToast()
const aiTranslate = usePtAiTranslate()
const canEdit = computed(() => can('pt.messages.write') || can('pt.campaigns.write'))

type Docs = Record<string, TiptapDoc | null>
type Note = 'welcome' | 'reminder'
const tagline = ref<TranslatableText | null>(props.emailText?.tagline ?? null)
const notes = reactive<Record<Note, Docs>>({
  welcome: { ...props.emailText?.welcome },
  reminder: { ...props.emailText?.reminder }
})

const lang = ref(props.defaultLanguage)
const isDefault = computed(() => lang.value === props.defaultLanguage)
const dir = computed(() => meta.value?.languages.find(l => l.code === lang.value)?.dir ?? 'ltr')
const inLanguage = computed(() => props.languages.length > 1 ? ` (${languageName(meta.value, lang.value)})` : '')

function noteModel(note: Note) {
  return computed({
    get: (): TiptapDoc | null => notes[note][lang.value] ?? null,
    set: (v: Record<string, unknown> | null) => { notes[note] = { ...notes[note], [lang.value]: v as TiptapDoc | null } }
  })
}
const welcomeDoc = noteModel('welcome')
const reminderDoc = noteModel('reminder')

const translating = ref<Note | null>(null)
async function translate(note: Note) {
  const src = notes[note][props.defaultLanguage]
  if (!src) return
  translating.value = note
  try {
    const res = await $fetch<{ doc: TiptapDoc }>('/api/pt/translate', { method: 'POST', body: { doc: src, from: props.defaultLanguage, to: lang.value } })
    notes[note] = { ...notes[note], [lang.value]: res.doc }
  } catch (err) {
    toast.fail(err, 'Translation failed')
  } finally {
    translating.value = null
  }
}

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    await $fetch(`/api/pt/campaigns/${props.campaignId}`, {
      method: 'PATCH',
      body: { email_text: { tagline: tagline.value, welcome: notes.welcome, reminder: notes.reminder } }
    })
    toast.ok('Email text saved')
    emit('saved')
  } catch (err) {
    toast.fail(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <UIcon
            name="i-lucide-mail-plus"
            class="size-5 text-primary"
          />
          <h2 class="font-semibold">
            Welcome and reminder emails
          </h2>
          <InfoTip text="Add your own words to the email people get when they sign up and to every prayer reminder. Left empty, the emails go out as they are. A language without its own text gets your site's default language." />
        </div>
        <USelect
          v-if="languages.length > 1"
          v-model="lang"
          :items="languages.map(l => ({ label: languageName(meta, l), value: l, icon: languageFlag(l) }))"
          :icon="languageFlag(lang)"
          class="w-44"
        />
      </div>
    </template>
    <fieldset
      :disabled="!canEdit"
      class="space-y-5"
    >
      <PtTranslatableInput
        v-model="tagline"
        :languages="languages"
        :default-language="defaultLanguage"
        label="Welcome tagline"
        help="A sentence right after the greeting in the welcome email."
        placeholder="e.g. Thank you for joining us in prayer!"
      />
      <UFormField>
        <template #label>
          Welcome email note{{ inLanguage }} <InfoTip text="Shown in the welcome email after the person's prayer times." />
        </template>
        <template
          v-if="!isDefault && canEdit && aiTranslate"
          #hint
        >
          <UButton
            size="xs"
            variant="soft"
            icon="i-lucide-languages"
            label="AI translate"
            :loading="translating === 'welcome'"
            :disabled="isEmptyDoc(notes.welcome[defaultLanguage])"
            @click="translate('welcome')"
          />
        </template>
        <PtRichEditor
          v-model="welcomeDoc"
          :dir="dir"
          :disabled="!canEdit"
          min-height="8rem"
          placeholder="e.g. what to expect, how to get ready, who to contact"
        />
      </UFormField>
      <UFormField>
        <template #label>
          Reminder note{{ inLanguage }} <InfoTip text="Shown in every prayer reminder, after its main text." />
        </template>
        <template
          v-if="!isDefault && canEdit && aiTranslate"
          #hint
        >
          <UButton
            size="xs"
            variant="soft"
            icon="i-lucide-languages"
            label="AI translate"
            :loading="translating === 'reminder'"
            :disabled="isEmptyDoc(notes.reminder[defaultLanguage])"
            @click="translate('reminder')"
          />
        </template>
        <PtRichEditor
          v-model="reminderDoc"
          :dir="dir"
          :disabled="!canEdit"
          min-height="8rem"
          placeholder="e.g. a verse or a short word of encouragement"
        />
      </UFormField>
    </fieldset>
    <template #footer>
      <div class="flex items-center gap-2 flex-wrap">
        <UButton
          v-if="canEdit"
          icon="i-lucide-check"
          label="Save email text"
          :loading="saving"
          @click="save"
        />
        <UButton
          v-if="can('pt.email.send')"
          :to="{ path: '/marketing/test-emails', query: { campaign: campaignId } }"
          variant="outline"
          color="neutral"
          icon="i-lucide-mail-check"
          label="Send a test email"
        />
      </div>
    </template>
  </UCard>
</template>
