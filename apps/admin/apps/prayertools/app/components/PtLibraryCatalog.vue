<script setup lang="ts">
// Library catalog: the template's suggested libraries first, "See more" for
// the rest; filters by cadence, language and text; preview entries before
// choosing. Emits the chosen library id.
interface Library {
  id: string
  title: string
  description: string | null
  cadence: 'daily' | 'weekly'
  entry_count: number
  languages: string[]
  topics: string[]
  license: string
  credit: string | null
  suggested: boolean
  mine: boolean
  platform: boolean
}

const props = withDefaults(defineProps<{ template?: string | null, cadence?: string, siteLanguages?: string[], usedIds?: string[] }>(), { template: null, cadence: undefined, siteLanguages: () => [], usedIds: () => [] })
const emit = defineEmits<{ use: [string] }>()
const { data: meta } = usePtMeta()

const q = ref('')
const cadence = ref<string | undefined>(props.cadence)
watch(() => props.cadence, (v) => {
  cadence.value = v
})
const seeMore = ref(false)
const { data, status } = useFetch<{ libraries: Library[] }>('/api/pt/libraries', {
  query: computed(() => ({ template: props.template ?? undefined, cadence: cadence.value, q: q.value || undefined })),
  key: computed(() => `pt-catalog-${props.template}-${cadence.value}-${q.value}`)
})

const suggested = computed(() => (data.value?.libraries ?? []).filter(l => l.suggested))
const others = computed(() => (data.value?.libraries ?? []).filter(l => !l.suggested))
const shown = computed(() => (seeMore.value || !suggested.value.length ? [...suggested.value, ...others.value] : suggested.value))
const groups = computed(() => {
  if (!suggested.value.length) return [{ title: null, libs: shown.value }]
  return [
    { title: 'Suggested for your site', libs: suggested.value },
    { title: 'More libraries', libs: seeMore.value ? others.value : [] }
  ].filter(g => g.libs.length)
})

const preview = reactive({ open: false, lib: null as Library | null, day: 1, lang: 'en', doc: null as Record<string, any> | null, loading: false })

async function loadPreview() {
  if (!preview.lib) return
  preview.loading = true
  try {
    const res = await $fetch<{ published: Record<string, any> | null }>(`/api/pt/libraries/${preview.lib.id}/entries/${preview.day}/${preview.lang}`)
    preview.doc = res.published
  } finally {
    preview.loading = false
  }
}

function openPreview(lib: Library) {
  preview.lib = lib
  preview.day = 1
  preview.lang = lib.languages.find(l => props.siteLanguages.includes(l)) ?? lib.languages[0] ?? 'en'
  preview.open = true
  loadPreview()
}

const previewUnit = computed(() => preview.lib?.cadence === 'weekly' ? 'week' : 'day')
function previewDay(delta: number) {
  preview.day += delta
  loadPreview()
}

function missing(lib: Library): string[] {
  return props.siteLanguages.filter(l => !lib.languages.includes(l))
}

function coverage(lib: Library): string {
  if (!props.siteLanguages.length) return lib.languages.map(l => languageName(meta.value, l)).join(', ')
  const have = props.siteLanguages.filter(l => lib.languages.includes(l))
  return `${have.length}/${props.siteLanguages.length} of your languages`
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap gap-2">
      <UInput
        v-model="q"
        icon="i-lucide-search"
        placeholder="Search libraries"
        class="w-full sm:w-72"
      />
      <USelect
        v-model="cadence"
        :items="[{ label: 'Daily', value: 'daily' }, { label: 'Weekly', value: 'weekly' }]"
        placeholder="Any cadence"
        class="w-40"
      />
      <UButton
        v-if="cadence"
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        aria-label="Clear cadence"
        @click="cadence = undefined"
      />
    </div>
    <div
      v-if="status === 'pending' && !data"
      class="text-sm text-(--ui-text-muted)"
    >
      Loading…
    </div>
    <div
      v-else-if="!shown.length"
      class="text-sm text-(--ui-text-muted)"
    >
      No libraries match. You can write your own content instead.
    </div>
    <div
      v-for="group in groups"
      :key="group.title ?? 'all'"
      class="space-y-2"
    >
      <h3
        v-if="group.title"
        class="text-sm font-semibold text-(--ui-text-muted)"
      >
        {{ group.title }}
      </h3>
      <UCard :ui="{ body: 'p-0 sm:p-0 divide-y divide-(--ui-border)' }">
        <div
          v-for="lib in group.libs"
          :key="lib.id"
          class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-4 py-3"
        >
          <div class="min-w-0 flex-1 space-y-0.5">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span class="font-medium">{{ lib.title }}</span>
              <UBadge
                v-if="lib.mine"
                label="Yours"
                color="neutral"
                variant="subtle"
                size="sm"
              />
              <UBadge
                v-for="t in lib.topics"
                :key="t"
                :label="t"
                size="sm"
                variant="outline"
                color="neutral"
              />
            </div>
            <p
              v-if="lib.description"
              class="text-sm text-(--ui-text-muted) line-clamp-1"
              :title="lib.description"
            >
              {{ lib.description }}
            </p>
            <p class="text-xs text-(--ui-text-dimmed)">
              {{ PT_LABELS.cadence[lib.cadence] ?? lib.cadence }} · {{ lib.entry_count }} {{ lib.cadence === 'weekly' ? 'weeks' : 'days' }} · {{ coverage(lib) }} · {{ PT_LABELS.license[lib.license] ?? lib.license }}<template v-if="lib.credit">
                · {{ lib.credit }}
              </template>
            </p>
            <p
              v-if="missing(lib).length"
              class="text-xs text-(--ui-warning)"
            >
              Not yet in {{ missing(lib).map(l => languageName(meta, l)).join(', ') }}
            </p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <UButton
              size="sm"
              color="neutral"
              variant="soft"
              icon="i-lucide-eye"
              label="Preview"
              @click="openPreview(lib)"
            />
            <UButton
              v-if="!usedIds.includes(lib.id)"
              size="sm"
              icon="i-lucide-plus"
              label="Use"
              @click="emit('use', lib.id)"
            />
            <UBadge
              v-else
              color="success"
              variant="subtle"
              icon="i-lucide-check"
              label="In use"
            />
          </div>
        </div>
      </UCard>
    </div>
    <UButton
      v-if="suggested.length && others.length && !seeMore"
      variant="soft"
      color="neutral"
      trailing-icon="i-lucide-chevron-down"
      :label="`See more (${others.length})`"
      @click="seeMore = true"
    />

    <UModal
      v-model:open="preview.open"
      :title="preview.lib?.title"
      :ui="{ content: 'max-w-2xl' }"
    >
      <template #body>
        <div class="space-y-3">
          <div class="flex gap-2 items-center">
            <UButton
              icon="i-lucide-chevron-left"
              color="neutral"
              variant="outline"
              :aria-label="`Previous ${previewUnit}`"
              :disabled="preview.day <= 1"
              @click="previewDay(-1)"
            />
            <span class="text-sm font-medium tabular-nums whitespace-nowrap">
              {{ previewUnit === 'week' ? 'Week' : 'Day' }} {{ preview.day }} of {{ preview.lib?.entry_count || 1 }}
            </span>
            <UButton
              icon="i-lucide-chevron-right"
              color="neutral"
              variant="outline"
              :aria-label="`Next ${previewUnit}`"
              :disabled="preview.day >= (preview.lib?.entry_count || 1)"
              @click="previewDay(1)"
            />
            <USelect
              v-model="preview.lang"
              :items="(preview.lib?.languages ?? []).map(l => ({ label: languageName(meta, l), value: l }))"
              class="w-44"
              @update:model-value="loadPreview"
            />
          </div>
          <div
            v-if="preview.loading"
            class="text-sm text-(--ui-text-muted)"
          >
            Loading…
          </div>
          <PtContentView
            v-else-if="preview.doc"
            :doc="preview.doc"
          />
          <p
            v-else
            class="text-sm text-(--ui-text-muted)"
          >
            No entry for this day in this language.
          </p>
        </div>
      </template>
    </UModal>
  </div>
</template>
