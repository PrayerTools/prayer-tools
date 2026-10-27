<script setup lang="ts">
// The public contact form's extra questions and who is notified of new
// messages (the site's admins unless specific people are chosen).
import type { ContactFormField, SiteContactForm, TranslatableText } from '@prayertools/shared/db/schema'

const { data: site, can } = usePtSite()
const toast = usePtToast()

interface Member { id: string, name: string, email: string, admin: boolean }
const MAX_FIELDS = 5
const KINDS = {
  text: { label: 'Short text', icon: 'i-lucide-text-cursor-input' },
  select: { label: 'Dropdown', icon: 'i-lucide-list' },
  checkbox: { label: 'Checkbox', icon: 'i-lucide-square-check' }
} as const

const { data, refresh } = useFetch<{ form: SiteContactForm, members: Member[] }>('/api/pt/site/contact-form', { key: 'pt-contact-form' })
const fields = ref<ContactFormField[]>([])
const notifyMode = ref<'admins' | 'chosen'>('admins')
const chosen = ref<string[]>([])
function reset() {
  const form = data.value?.form ?? {}
  fields.value = structuredClone(toRaw(form.fields ?? []))
  notifyMode.value = form.notify_user_ids?.length ? 'chosen' : 'admins'
  chosen.value = [...(form.notify_user_ids ?? [])]
}
watch(data, reset, { immediate: true })

const members = computed(() => data.value?.members ?? [])
const admins = computed(() => members.value.filter(m => m.admin))
const memberItems = computed(() => members.value.map(m => ({ label: m.name, description: m.email, value: m.id })))
const notifyItems = computed(() => [
  { value: 'admins', label: 'All admins', description: admins.value.map(m => m.name).join(', ') || 'This site has no admins who can open the inbox.' },
  { value: 'chosen', label: 'Specific people', description: 'Anyone on the team who can open the inbox.' }
])

const body = computed(() => ({ fields: fields.value, notify_user_ids: notifyMode.value === 'chosen' ? chosen.value : [] }))
const saved = computed(() => ({ fields: data.value?.form.fields ?? [], notify_user_ids: data.value?.form.notify_user_ids ?? [] }))
const dirty = computed(() => JSON.stringify(body.value) !== JSON.stringify(saved.value))

const addFieldItems = computed(() => (Object.keys(KINDS) as ContactFormField['kind'][]).map(kind => ({
  label: KINDS[kind].label,
  icon: KINDS[kind].icon,
  onSelect: () => addField(kind)
})))
function emptyText(): TranslatableText {
  const l = site.value!.site.default_language
  return { source: l, values: { [l]: '' }, stale: [] }
}
function addField(kind: ContactFormField['kind']) {
  const field: ContactFormField = { key: '', kind, label: emptyText(), options: [], required: false }
  if (kind === 'select') {
    addOption(field)
    addOption(field)
  }
  fields.value.push(field)
}
function addOption(field: ContactFormField) {
  const next = Math.max(0, ...field.options.map(o => Number(o.key.slice(1)) || 0)) + 1
  field.options.push({ key: `o${next}`, label: emptyText() })
}
function moveField(i: number, dir: -1 | 1) {
  const [moved] = fields.value.splice(i, 1)
  fields.value.splice(i + dir, 0, moved!)
}

// The form as visitors see it, in the site's default language, with unsaved edits.
const previewAnswers = ref<Record<string, string | boolean>>({})
const preview = computed(() => {
  const l = site.value!.site.default_language
  const text = (t: TranslatableText) => t.values[l] || t.values[t.source] || ''
  return fields.value.map((f, i) => ({
    id: f.key || `new-${i}`,
    kind: f.kind,
    label: text(f.label) || 'Untitled question',
    required: f.required,
    options: f.options.map((o, j) => ({ label: text(o.label) || `Option ${j + 1}`, value: o.key }))
  }))
})

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    await $fetch('/api/pt/site/contact-form', { method: 'PUT', body: body.value })
    await refresh()
    toast.ok('Saved')
  } catch (err) {
    toast.fail(err)
  } finally {
    saving.value = false
  }
}

defineExpose({ dirty, reset })
</script>

<template>
  <div
    v-if="site && data"
    class="space-y-6"
  >
    <UCard>
      <template #header>
        <h2 class="font-semibold">
          Notify
        </h2>
        <p class="text-sm text-muted">
          Who hears about new contact messages. They see them in the notification bell and the inbox, and get them in
          their daily email digest.
        </p>
      </template>
      <div class="space-y-4">
        <URadioGroup
          v-model="notifyMode"
          :items="notifyItems"
          :disabled="!can('pt.site.write')"
        />
        <UFormField
          v-if="notifyMode === 'chosen'"
          label="People"
        >
          <USelectMenu
            v-model="chosen"
            :items="memberItems"
            value-key="value"
            multiple
            placeholder="Choose people"
            :disabled="!can('pt.site.write')"
            class="w-full"
          />
        </UFormField>
      </div>
    </UCard>

    <section class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">
            Custom questions
          </h2>
          <p class="text-sm text-muted">
            The form always asks for a name, an email address and a message. Add up to {{ MAX_FIELDS }} questions of your
            own; the answers appear under the message in your inbox.
          </p>
        </div>
        <UDropdownMenu
          v-if="can('pt.site.write')"
          :items="addFieldItems"
        >
          <UButton
            icon="i-lucide-plus"
            label="Add a question"
            :disabled="fields.length >= MAX_FIELDS"
          />
        </UDropdownMenu>
      </div>

      <UCard
        v-if="!fields.length"
        variant="subtle"
      >
        <p class="text-sm text-muted">
          No questions yet.
        </p>
      </UCard>

      <UCard
        v-for="(f, i) in fields"
        :key="f.key || `new-${i}`"
      >
        <div class="space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <UBadge
              variant="subtle"
              color="neutral"
              :icon="KINDS[f.kind]?.icon"
              :label="KINDS[f.kind]?.label ?? f.kind"
            />
            <div
              v-if="can('pt.site.write')"
              class="flex items-center gap-1"
            >
              <USwitch
                v-model="f.required"
                label="Required"
                class="me-3"
              />
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                icon="i-lucide-arrow-up"
                aria-label="Move up"
                :disabled="i === 0"
                @click="moveField(i, -1)"
              />
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                icon="i-lucide-arrow-down"
                aria-label="Move down"
                :disabled="i === fields.length - 1"
                @click="moveField(i, 1)"
              />
              <UButton
                size="xs"
                variant="ghost"
                color="error"
                icon="i-lucide-trash-2"
                aria-label="Remove question"
                @click="fields.splice(i, 1)"
              />
            </div>
            <UBadge
              v-else-if="f.required"
              variant="outline"
              color="neutral"
              label="Required"
            />
          </div>
          <PtTranslatableInput
            v-model="f.label"
            :languages="site.site.languages"
            :default-language="site.site.default_language"
            :label="f.kind === 'checkbox' ? 'Checkbox text' : 'Question'"
            :placeholder="f.kind === 'checkbox' ? 'Please call me back' : 'Phone number'"
            :source-locked="!can('pt.site.write')"
          />
          <div
            v-if="f.kind === 'select'"
            class="space-y-3 border-s-2 border-default ps-4"
          >
            <div class="text-sm font-medium">
              Options
            </div>
            <div
              v-for="(o, j) in f.options"
              :key="o.key"
              class="flex items-start gap-2"
            >
              <PtTranslatableInput
                v-model="o.label"
                :languages="site.site.languages"
                :default-language="site.site.default_language"
                :placeholder="`Option ${j + 1}`"
                :source-locked="!can('pt.site.write')"
                class="flex-1 min-w-0"
              />
              <UButton
                v-if="can('pt.site.write')"
                size="xs"
                variant="ghost"
                color="neutral"
                icon="i-lucide-x"
                aria-label="Remove option"
                class="mt-1"
                :disabled="f.options.length <= 2"
                @click="f.options.splice(j, 1)"
              />
            </div>
            <UButton
              v-if="can('pt.site.write')"
              size="sm"
              variant="soft"
              icon="i-lucide-plus"
              label="Add option"
              @click="addOption(f)"
            />
          </div>
        </div>
      </UCard>
    </section>

    <UCard>
      <template #header>
        <h2 class="font-semibold">
          Preview
        </h2>
        <p class="text-sm text-muted">
          How the contact page looks to visitors, including changes you haven't saved.
        </p>
      </template>
      <div class="space-y-4 max-w-2xl">
        <p class="text-sm">
          Write to the team behind {{ site.org.name }}. They will reply by email.
        </p>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Name">
            <UInput class="w-full" />
          </UFormField>
          <UFormField
            label="Email"
            required
          >
            <UInput
              type="email"
              class="w-full"
            />
          </UFormField>
        </div>
        <UFormField
          label="Message"
          required
        >
          <UTextarea
            :rows="4"
            class="w-full"
          />
        </UFormField>
        <UFormField
          v-for="f in preview"
          :key="f.id"
          :label="f.kind === 'checkbox' ? undefined : f.label"
          :required="f.required"
        >
          <UInput
            v-if="f.kind === 'text'"
            v-model="(previewAnswers[f.id] as string)"
            class="w-full"
          />
          <USelect
            v-else-if="f.kind === 'select'"
            v-model="(previewAnswers[f.id] as string)"
            :items="f.options"
            placeholder="Choose…"
            class="w-full"
          />
          <UCheckbox
            v-else
            v-model="(previewAnswers[f.id] as boolean)"
            :label="f.label"
            :required="f.required"
          />
        </UFormField>
        <UButton
          label="Send message"
          disabled
        />
      </div>
    </UCard>

    <PtSaveBar
      v-if="can('pt.site.write') || can('pt.content.translate')"
      :dirty="dirty"
      :saving="saving"
      label="Save contact form"
      @save="save"
      @discard="reset"
    />
  </div>
</template>
