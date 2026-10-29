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
const searchQuery = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(q, value => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { searchQuery.value = value.trim() }, 350)
})
onBeforeUnmount(() => clearTimeout(searchTimer))
const cadence = ref<string | undefined>(props.cadence)
watch(() => props.cadence, (v) => {
  cadence.value = v
})
const seeMore = ref(false)
const { data, status, error: catalogError, refresh } = useFetch<{ libraries: Library[] }>('/api/pt/libraries', {
  query: computed(() => ({ template: props.template ?? undefined, cadence: cadence.value, q: searchQuery.value || undefined })),
  key: `pt-catalog-${useId()}`,
  dedupe: 'cancel'
})

const results = shallowRef<Library[]>([])
const hasResults = ref(false)
const completedQuery = ref('')
watch([data, status], ([response, requestStatus]) => {
  if (requestStatus === 'success' && response) {
    results.value = response.libraries
    hasResults.value = true
    completedQuery.value = searchQuery.value
  }
}, { immediate: true })
const isSearching = computed(() => status.value === 'pending' || q.value.trim() !== searchQuery.value)
const suggested = computed(() => results.value.filter(l => l.suggested))
const others = computed(() => results.value.filter(l => !l.suggested))
const shown = computed(() => (seeMore.value || !suggested.value.length ? [...suggested.value, ...others.value] : suggested.value))

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
        aria-label="Search libraries"
        :loading="status === 'pending'"
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
    <p class="text-xs text-(--ui-text-muted)">Results update as you type. The daily or weekly filter also affects your results.</p>
    <div class="min-h-88 space-y-4" :aria-busy="isSearching">
    <div class="min-h-6" aria-live="polite" aria-atomic="true">
      <p v-if="isSearching" class="text-sm text-(--ui-text-muted)" role="status">{{ hasResults ? 'Updating results…' : 'Searching libraries…' }}</p>
      <UAlert v-else-if="catalogError" color="error" variant="soft" icon="i-lucide-triangle-alert" title="We couldn't load the libraries" description="The search did not complete. Try again; this does not mean there are no matching libraries." :actions="[{ label: 'Try again', color: 'neutral', variant: 'outline', onClick: () => refresh() }]" />
      <p v-else-if="hasResults" class="text-sm text-(--ui-text-muted)">{{ results.length }} {{ results.length === 1 ? 'library found' : 'libraries found' }}{{ !seeMore && suggested.length && others.length ? ' · showing suggested libraries first' : '' }}</p>
    </div>
      <div v-if="hasResults && !shown.length && !catalogError" class="rounded-xl border border-(--ui-border) bg-(--ui-bg-muted) p-5 space-y-3">
        <p class="font-semibold">{{ completedQuery ? `No libraries found for “${completedQuery}”` : 'No libraries match these filters' }}</p>
        <p class="text-sm text-(--ui-text-muted)">The search completed. Try a different search or clear the filters to browse all available libraries. You can also write your own content below.</p>
        <UButton v-if="q || cadence" label="Clear search and filters" color="neutral" variant="outline" @click="q = ''; cadence = undefined; seeMore = true" />
      </div>
    <h3
      v-if="hasResults && !catalogError && suggested.length && shown.length"
      class="text-sm font-semibold text-(--ui-text-muted)"
    >
      Suggested for your site
    </h3>
    <div v-if="hasResults && !catalogError" class="grid md:grid-cols-2 gap-3">
      <template
        v-for="(lib, i) in shown"
        :key="lib.id"
      >
        <h3
          v-if="suggested.length && i === suggested.length"
          class="md:col-span-2 pt-2 text-sm font-semibold text-(--ui-text-muted)"
        >
          More libraries
        </h3>
        <UCard :ui="{ body: 'space-y-2' }">
          <div class="flex items-start justify-between gap-2">
            <h3 class="font-semibold">
              {{ lib.title }}
            </h3>
            <div class="flex gap-1">
              <UBadge
                v-if="lib.suggested"
                label="Suggested"
                color="primary"
                variant="subtle"
                size="sm"
              />
              <UBadge
                v-if="lib.mine"
                label="Yours"
                color="neutral"
                variant="subtle"
                size="sm"
              />
            </div>
          </div>
          <p
            v-if="lib.description"
            class="text-sm text-(--ui-text-muted) line-clamp-3"
          >
            {{ lib.description }}
          </p>
          <p class="text-xs text-(--ui-text-muted)">
            {{ PT_LABELS.cadence[lib.cadence] ?? lib.cadence }} · {{ lib.entry_count }} {{ lib.cadence === 'weekly' ? 'weeks' : 'days' }} · {{ coverage(lib) }} · {{ PT_LABELS.license[lib.license] ?? lib.license }}
          </p>
          <div
            v-if="lib.topics?.length"
            class="flex flex-wrap gap-1"
          >
            <UBadge
              v-for="t in lib.topics"
              :key="t"
              :label="t"
              size="sm"
              variant="subtle"
              color="neutral"
            />
          </div>
          <p
            v-if="missing(lib).length"
            class="text-xs text-(--ui-warning)"
          >
            Not yet in {{ missing(lib).map(l => languageName(meta, l)).join(', ') }}
          </p>
          <p
            v-if="lib.credit"
            class="text-xs text-(--ui-text-dimmed)"
          >
            {{ lib.credit }}
          </p>
          <div class="flex flex-wrap items-center gap-2 pt-1">
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
              label="Use this library"
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
        </UCard>
      </template>
    </div>
    <UButton
      v-if="hasResults && !catalogError && suggested.length && others.length && !seeMore"
      variant="soft"
      color="neutral"
      trailing-icon="i-lucide-chevron-down"
      :label="`See more (${others.length})`"
      @click="seeMore = true"
    />
    </div>

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
