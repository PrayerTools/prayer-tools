<script setup lang="ts">
// Champion text written in one language and translated into the site's
// others. Editing the source language flags the other languages as out of
// date; each translation stays editable and can be (re)done with AI.
import type { TranslatableText } from '@prayertools/shared/db/schema'
import { setText, isStale } from '@prayertools/shared/translatable'

const props = withDefaults(defineProps<{
  languages: string[]
  defaultLanguage: string
  label?: string
  help?: string
  multiline?: boolean
  placeholder?: string
  required?: boolean
  sourceLocked?: boolean
}>(), { multiline: false, required: false, sourceLocked: false })

const model = defineModel<TranslatableText | null>({ default: null })
const { data: meta } = usePtMeta()
const toast = usePtToast()
const translating = ref<string | null>(null)
const TextareaField = resolveComponent('UTextarea')
const InputField = resolveComponent('UInput')
const field = computed(() => (props.multiline ? TextareaField : InputField))

const source = computed(() => model.value?.source ?? props.defaultLanguage)
const others = computed(() => props.languages.filter(l => l !== source.value))
const showTranslations = ref(false)

function valueOf(lang: string): string {
  return model.value?.values[lang] ?? ''
}

function update(lang: string, value: string) {
  model.value = setText(model.value ?? { source: props.defaultLanguage, values: {}, stale: [] }, lang, value)
}

async function translate(lang: string) {
  const text = valueOf(source.value)
  if (!text.trim()) return
  translating.value = lang
  try {
    const res = await $fetch<{ texts: string[] }>('/api/pt/translate', { method: 'POST', body: { texts: [text], from: source.value, to: lang } })
    update(lang, res.texts[0] ?? '')
  } catch (err) {
    toast.fail(err, 'Translation failed')
  } finally {
    translating.value = null
  }
}
</script>

<template>
  <UFormField
    :label="label"
    :required="required"
  >
    <template
      v-if="label && help"
      #label
    >
      {{ label }} <InfoTip :text="help" />
    </template>
    <component
      :is="field"
      :model-value="valueOf(source)"
      :placeholder="placeholder"
      :disabled="sourceLocked"
      :rows="multiline ? 3 : undefined"
      :autoresize="multiline || undefined"
      :dir="meta?.languages.find(l => l.code === source)?.dir"
      class="w-full"
      @update:model-value="(v: string) => update(source, v)"
    />
    <div
      v-if="others.length"
      class="mt-1"
    >
      <UButton
        size="xs"
        variant="link"
        color="neutral"
        :icon="showTranslations ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
        :label="`Translations (${others.filter(l => valueOf(l)).length}/${others.length})`"
        @click="showTranslations = !showTranslations"
      />
      <div
        v-if="showTranslations"
        class="mt-2 space-y-2 border-s-2 border-(--ui-border) ps-3"
      >
        <div
          v-for="lang in others"
          :key="lang"
          class="space-y-1"
        >
          <div class="flex items-center gap-2 text-xs text-(--ui-text-muted)">
            <span class="font-medium">{{ languageName(meta, lang) }}</span>
            <UBadge
              v-if="isStale(model, lang)"
              color="warning"
              variant="soft"
              size="sm"
              label="Out of date"
            />
            <UBadge
              v-else-if="!valueOf(lang)"
              color="neutral"
              variant="soft"
              size="sm"
              label="Missing"
            />
            <UButton
              size="xs"
              variant="ghost"
              icon="i-lucide-languages"
              label="AI translate"
              :loading="translating === lang"
              :disabled="!valueOf(source).trim()"
              @click="translate(lang)"
            />
          </div>
          <component
            :is="field"
            :model-value="valueOf(lang)"
            :rows="multiline ? 2 : undefined"
            :autoresize="multiline || undefined"
            :dir="meta?.languages.find(l => l.code === lang)?.dir"
            size="sm"
            class="w-full"
            @update:model-value="(v: string) => update(lang, v)"
          />
        </div>
      </div>
    </div>
  </UFormField>
</template>
