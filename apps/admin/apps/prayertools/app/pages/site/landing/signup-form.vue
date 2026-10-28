<script setup lang="ts">
// The signup form: what the public form always asks, the site's own questions
// (answers live on the CRM contact) and its own consent boxes.
import type { TranslatableText } from '@prayertools/shared/db/schema'

definePageMeta({ middleware: 'auth' })

const { data: site, can } = usePtSite()
const toast = usePtToast()

interface Field { id: string, key: string, kind: 'text' | 'select' | 'checkbox', label: TranslatableText, options: { key: string, label: TranslatableText }[], required: boolean, position: number }
interface Option { id: string, key: string, label: TranslatableText, active: boolean }
const MAX_FIELDS = 5
const MAX_CONSENT_OPTIONS = 5
const KINDS = {
  text: { label: 'Short text', icon: 'i-lucide-text-cursor-input' },
  select: { label: 'Dropdown', icon: 'i-lucide-list' },
  checkbox: { label: 'Checkbox', icon: 'i-lucide-square-check' }
} as const
// The fields the public signup form asks on every site.
const alwaysAsked = computed(() => [
  { icon: 'i-lucide-mail', label: 'Email address', note: 'required; people can also sign in with Google or Apple where available' },
  { icon: 'i-lucide-user', label: 'First name', note: 'optional' },
  ...((site.value?.site.languages.length ?? 0) > 1 ? [{ icon: 'i-lucide-languages', label: 'Language', note: 'one of your site’s languages' }] : []),
  { icon: 'i-lucide-globe', label: 'Time zone', note: 'reminders are sent at their local time' },
  { icon: 'i-lucide-alarm-clock', label: 'Prayer times', note: 'when to send reminders and for how long; they can add more than one' },
  { icon: 'i-lucide-square', label: `“Send me updates from ${site.value?.org.name ?? 'this site'}”`, note: '' },
  { icon: 'i-lucide-square', label: '“Send me news from Prayer.Tools”', note: '' }
])
const { data: signup, refresh: refreshSignup } = useFetch<{ fields: Field[], consentOptions: Option[] }>('/api/pt/signup-fields', { key: 'pt-signup-fields' })
const fields = computed(() => signup.value?.fields ?? [])
const newField = reactive({ kind: null as Field['kind'] | null, label: null as TranslatableText | null, options: [] as { key: string, label: TranslatableText }[], required: false })
const addFieldItems = computed(() => (Object.keys(KINDS) as Field['kind'][]).map(kind => ({
  label: KINDS[kind].label,
  icon: KINDS[kind].icon,
  onSelect: () => startField(kind)
})))
function startField(kind: Field['kind']) {
  Object.assign(newField, { kind, label: null, options: [], required: false })
  if (kind === 'select') {
    addOption()
    addOption()
  }
}
function addOption() {
  const l = site.value!.site.default_language
  const next = Math.max(0, ...newField.options.map(o => Number(o.key.slice(1)) || 0)) + 1
  newField.options.push({ key: `o${next}`, label: { source: l, values: { [l]: '' }, stale: [] } })
}
const creatingField = ref(false)
async function createField() {
  creatingField.value = true
  try {
    await $fetch('/api/pt/signup-fields', { method: 'POST', body: { ...newField } })
    Object.assign(newField, { kind: null, label: null, options: [], required: false })
    await refreshSignup()
    toast.ok('Question added')
  } catch (err) {
    toast.fail(err)
  } finally {
    creatingField.value = false
  }
}
async function saveField(f: Field) {
  try {
    await $fetch(`/api/pt/signup-fields/${f.id}`, { method: 'PATCH', body: { label: f.label, options: f.options } })
    toast.ok('Saved')
  } catch (err) {
    toast.fail(err)
  }
}
async function setRequired(f: Field, required: boolean) {
  try {
    await $fetch(`/api/pt/signup-fields/${f.id}`, { method: 'PATCH', body: { required } })
    await refreshSignup()
  } catch (err) {
    toast.fail(err)
  }
}
async function moveField(i: number, dir: -1 | 1) {
  const list = [...fields.value]
  const [moved] = list.splice(i, 1)
  list.splice(i + dir, 0, moved!)
  try {
    await Promise.all(list.map((f, position) => f.position === position ? null : $fetch(`/api/pt/signup-fields/${f.id}`, { method: 'PATCH', body: { position } })))
  } catch (err) {
    toast.fail(err)
  }
  await refreshSignup()
}
const removingField = ref<Field | null>(null)
const removeFieldOpen = computed({
  get: () => !!removingField.value,
  set: (v) => { if (!v) removingField.value = null }
})
async function deleteField() {
  const f = removingField.value
  if (!f) return
  try {
    await $fetch(`/api/pt/signup-fields/${f.id}`, { method: 'DELETE' })
    removingField.value = null
    await refreshSignup()
    toast.ok('Question removed')
  } catch (err) {
    toast.fail(err)
  }
}
const addingOption = ref(false)
const newOption = ref<TranslatableText | null>(null)
async function createOption() {
  try {
    await $fetch('/api/pt/consent-options', { method: 'POST', body: { label: newOption.value } })
    newOption.value = null
    addingOption.value = false
    await refreshSignup()
    toast.ok('Consent box added')
  } catch (err) {
    toast.fail(err)
  }
}
async function saveOption(o: Option, patch: Record<string, unknown>) {
  try {
    await $fetch(`/api/pt/consent-options/${o.id}`, { method: 'PATCH', body: patch })
    await refreshSignup()
    if ('label' in patch) toast.ok('Saved')
  } catch (err) {
    toast.fail(err)
  }
}
</script>

<template>
  <div
    v-if="site"
    class="max-w-4xl mx-auto space-y-8"
  >
    <PtLandingTabs />
    <header>
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="text-2xl font-bold">
          Signup form
        </h1>
        <UBadge
          color="neutral"
          variant="outline"
          icon="i-lucide-layers"
          label="Shared by all campaigns"
        />
      </div>
      <p class="text-sm text-muted max-w-xl">
        Ask intercessors a few questions of your own when they sign up, and add your own consent boxes.
        Answers show on each intercessor’s record and in exports. They are never sent to analytics.
      </p>
    </header>

    <UAlert
      v-if="!can('pt.site.write')"
      color="neutral"
      variant="subtle"
      icon="i-lucide-lock"
      title="Only owners and editors can change the signup form. Translators can edit the wording."
    />

    <UCard>
      <template #header>
        <h2 class="font-semibold">
          Always asked
        </h2>
      </template>
      <ul class="space-y-2 text-sm">
        <li
          v-for="a in alwaysAsked"
          :key="a.label"
          class="flex items-start gap-2"
        >
          <UIcon
            :name="a.icon"
            class="text-muted size-4 mt-0.5 shrink-0"
          />
          <span>
            {{ a.label }}<span
              v-if="a.note"
              class="text-muted"
            > · {{ a.note }}</span>
          </span>
        </li>
      </ul>
      <p class="text-sm text-muted mt-3">
        Both consent boxes are unchecked by default. Site emails go only to people who ticked “updates from this site”
        (or one of your own consent boxes). Prayer reminders don’t need consent; they come with signing up.
      </p>
    </UCard>

    <section class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">
            Your questions
          </h2>
          <p class="text-sm text-muted">
            Up to {{ MAX_FIELDS }}. Keep the form short: every extra question means fewer signups. Answers are saved on
            each person's contact record.
          </p>
        </div>
        <UDropdownMenu
          v-if="can('pt.site.write')"
          :items="addFieldItems"
        >
          <UButton
            icon="i-lucide-plus"
            label="Add a question"
            :disabled="fields.length >= MAX_FIELDS || !!newField.kind"
          />
        </UDropdownMenu>
      </div>

      <UCard
        v-if="!fields.length && !newField.kind"
        variant="subtle"
      >
        <p class="text-sm text-muted">
          No questions yet. People sign up with just the details above.
        </p>
      </UCard>

      <UCard
        v-for="(f, i) in fields"
        :key="f.id"
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
                :model-value="f.required"
                label="Required"
                class="me-3"
                @update:model-value="(v: boolean) => setRequired(f, v)"
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
                aria-label="Stop asking"
                @click="removingField = f"
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
            :source-locked="!can('pt.site.write')"
          />
          <div
            v-if="f.kind === 'select'"
            class="space-y-3 border-s-2 border-default ps-4"
          >
            <div class="text-sm font-medium">
              Options
            </div>
            <PtTranslatableInput
              v-for="(o, j) in f.options"
              :key="o.key"
              v-model="o.label"
              :languages="site.site.languages"
              :default-language="site.site.default_language"
              :placeholder="`Option ${j + 1}`"
              :source-locked="!can('pt.site.write')"
            />
          </div>
          <div class="flex justify-end">
            <UButton
              size="sm"
              label="Save"
              @click="saveField(f)"
            />
          </div>
        </div>
      </UCard>

      <UCard
        v-if="newField.kind"
        :ui="{ root: 'ring-primary/50' }"
      >
        <div class="space-y-4">
          <UBadge
            variant="subtle"
            :icon="KINDS[newField.kind].icon"
            :label="`New ${KINDS[newField.kind].label.toLowerCase()}`"
          />
          <PtTranslatableInput
            v-model="newField.label"
            :languages="site.site.languages"
            :default-language="site.site.default_language"
            :label="newField.kind === 'checkbox' ? 'Checkbox text' : 'Question'"
            :placeholder="newField.kind === 'checkbox' ? 'I would like to join a prayer group' : 'Which church do you attend?'"
          />
          <div
            v-if="newField.kind === 'select'"
            class="space-y-3 border-s-2 border-default ps-4"
          >
            <div class="text-sm font-medium">
              Options
            </div>
            <div
              v-for="(o, j) in newField.options"
              :key="o.key"
              class="flex items-start gap-2"
            >
              <PtTranslatableInput
                v-model="o.label"
                :languages="site.site.languages"
                :default-language="site.site.default_language"
                :placeholder="`Option ${j + 1}`"
                class="flex-1 min-w-0"
              />
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                icon="i-lucide-x"
                aria-label="Remove option"
                class="mt-1"
                :disabled="newField.options.length <= 2"
                @click="newField.options.splice(j, 1)"
              />
            </div>
            <UButton
              size="sm"
              variant="soft"
              icon="i-lucide-plus"
              label="Add option"
              @click="addOption"
            />
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <USwitch
              v-model="newField.required"
              label="Required"
            />
            <div class="flex gap-2">
              <UButton
                variant="ghost"
                color="neutral"
                label="Cancel"
                @click="newField.kind = null"
              />
              <UButton
                icon="i-lucide-plus"
                label="Add question"
                :loading="creatingField"
                @click="createField"
              />
            </div>
          </div>
        </div>
      </UCard>
    </section>

    <section class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">
            Your consent boxes
          </h2>
          <p class="text-sm text-muted">
            Extra unchecked boxes after the two above, e.g. “Tell me about the mission trip”. Everyone who ticks one
            becomes an audience for site emails. Up to {{ MAX_CONSENT_OPTIONS }}.
          </p>
        </div>
        <UButton
          v-if="can('pt.site.write')"
          icon="i-lucide-plus"
          variant="soft"
          label="Add a consent box"
          :disabled="(signup?.consentOptions.length ?? 0) >= MAX_CONSENT_OPTIONS || addingOption"
          @click="addingOption = true"
        />
      </div>

      <UCard
        v-for="o in signup?.consentOptions ?? []"
        :key="o.id"
        :class="o.active ? '' : 'opacity-75'"
      >
        <div class="space-y-3">
          <PtTranslatableInput
            v-model="o.label"
            :languages="site.site.languages"
            :default-language="site.site.default_language"
            label="Checkbox text"
            :source-locked="!can('pt.site.write')"
          />
          <div class="flex items-center justify-between gap-2">
            <USwitch
              :model-value="o.active"
              label="Offered at signup"
              :disabled="!can('pt.site.write')"
              @update:model-value="(v: boolean) => saveOption(o, { active: v })"
            />
            <UButton
              size="sm"
              label="Save"
              @click="saveOption(o, { label: o.label })"
            />
          </div>
        </div>
      </UCard>

      <UCard
        v-if="addingOption"
        :ui="{ root: 'ring-primary/50' }"
      >
        <div class="space-y-4">
          <PtTranslatableInput
            v-model="newOption"
            :languages="site.site.languages"
            :default-language="site.site.default_language"
            label="Checkbox text"
            placeholder="Tell me about the mission trip"
          />
          <div class="flex justify-end gap-2">
            <UButton
              variant="ghost"
              color="neutral"
              label="Cancel"
              @click="addingOption = false; newOption = null"
            />
            <UButton
              icon="i-lucide-plus"
              label="Add consent box"
              @click="createOption"
            />
          </div>
        </div>
      </UCard>
    </section>

    <UModal
      v-model:open="removeFieldOpen"
      title="Stop asking this question?"
      description="It is removed from your signup form. Answers people already gave stay on their records and in exports."
    >
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="removingField = null"
          />
          <UButton
            label="Stop asking"
            color="error"
            icon="i-lucide-trash-2"
            @click="deleteField"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
