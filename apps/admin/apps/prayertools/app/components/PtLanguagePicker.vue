<script setup lang="ts">
// The languages a site runs in and its default. The languages the public site
// is translated into are always listed; others can be added for content only.
import { languageFlag } from '@prayertools/shared/languages'

const languages = defineModel<string[]>({ required: true })
const defaultLanguage = defineModel<string>('default', { required: true })
defineProps<{ disabled?: boolean }>()

const { data: meta } = usePtMeta()
const uiLanguages = computed(() => meta.value?.uiLanguages ?? [])
const byCode = computed(() => new Map((meta.value?.languages ?? []).map(l => [l.code, l])))

// Content-only languages stay listed once added, even when unticked.
const extras = ref<string[]>([])
watch([languages, uiLanguages], ([codes, ui]) => {
  for (const c of codes) if (!ui.includes(c) && !extras.value.includes(c)) extras.value.push(c)
}, { immediate: true })

const rows = computed(() => [...uiLanguages.value, ...extras.value].map(code => ({
  code,
  name: byCode.value.get(code)?.name ?? code,
  native: byCode.value.get(code)?.native,
  translated: uiLanguages.value.includes(code),
  selected: languages.value.includes(code),
  isDefault: code === defaultLanguage.value
})))

const addItems = computed(() => (meta.value?.languages ?? [])
  .filter(l => !uiLanguages.value.includes(l.code) && !extras.value.includes(l.code))
  .map(l => ({ label: `${l.name} — ${l.native}`, value: l.code, icon: languageFlag(l.code) })))

function toggle(code: string, on: boolean) {
  if (on && !languages.value.includes(code)) languages.value = [...languages.value, code]
  if (!on) languages.value = languages.value.filter(c => c !== code)
}
function makeDefault(code: string) {
  toggle(code, true)
  defaultLanguage.value = code
}

const adding = ref<string | undefined>()
watch(adding, (code) => {
  if (!code) return
  extras.value.push(code)
  toggle(code, true)
  nextTick(() => {
    adding.value = undefined
  })
})
</script>

<template>
  <div class="space-y-3">
    <div class="grid sm:grid-cols-2 gap-2">
      <div
        v-for="r in rows"
        :key="r.code"
        role="checkbox"
        :aria-checked="r.selected"
        :aria-disabled="disabled || r.isDefault"
        :tabindex="disabled || r.isDefault ? -1 : 0"
        class="flex items-center gap-3 rounded-lg border px-3 py-2 select-none focus-visible:outline-2 focus-visible:outline-(--ui-primary)"
        :class="[r.selected ? 'border-(--ui-primary) bg-(--ui-primary)/5' : 'border-(--ui-border)', disabled || r.isDefault ? '' : 'cursor-pointer hover:bg-(--ui-bg-elevated)']"
        @click="!disabled && !r.isDefault && toggle(r.code, !r.selected)"
        @keydown.space.prevent="!disabled && !r.isDefault && toggle(r.code, !r.selected)"
      >
        <UIcon
          :name="languageFlag(r.code)"
          class="size-5 shrink-0"
        />
        <UCheckbox
          :model-value="r.selected"
          :disabled="disabled || r.isDefault"
          :label="r.name"
          :description="r.native && r.native !== r.name ? r.native : undefined"
          tabindex="-1"
          class="flex-1 min-w-0 pointer-events-none"
        />
        <UBadge
          v-if="!r.translated"
          label="Content only"
          color="neutral"
          variant="subtle"
          size="sm"
        />
        <UBadge
          v-if="r.isDefault"
          label="Default"
          variant="subtle"
          size="sm"
        />
        <UButton
          v-else-if="r.selected && !disabled"
          label="Make default"
          color="neutral"
          variant="ghost"
          size="xs"
          @click.stop="makeDefault(r.code)"
        />
      </div>
    </div>
    <USelectMenu
      v-if="addItems.length && !disabled"
      v-model="adding"
      :items="addItems"
      value-key="value"
      placeholder="Add another language"
      icon="i-lucide-plus"
      class="w-full sm:w-72"
    />
    <p class="text-xs text-(--ui-text-muted)">
      The default language is used when a visitor's language isn't one of the site's. Content-only languages are for your own content; the site's buttons, forms and emails show in English for them.
    </p>
  </div>
</template>
