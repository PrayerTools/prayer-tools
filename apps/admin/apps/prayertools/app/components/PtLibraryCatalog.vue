<script setup lang="ts">
// Library catalog, ranked by fit with the campaign: the template's libraries,
// the site's languages and the campaign's length. Shows the best match first,
// the template's other libraries next and "See more" for the rest; a series
// shows its newest edition with the earlier ones a click away. Filters by
// topic, language, cadence and text; preview entries before choosing. Emits
// the chosen library id.
interface Library {
  id: string
  owner_user_id: string | null
  title: string
  description: string | null
  cadence: 'daily' | 'weekly'
  entry_count: number
  languages: string[]
  topics: string[]
  series: string | null
  edition: string | null
  license: string
  credit: string | null
  suggested: boolean
  mine: boolean
  platform: boolean
  role: 'owner' | 'editor' | 'viewer' | null
}

interface Card {
  key: string
  lib: Library
  // Earlier editions of the series, newest first.
  earlier: Library[]
  score: number
}

const props = withDefaults(defineProps<{ template?: string | null, cadence?: string, length?: number | null, siteLanguages?: string[], usedIds?: string[] }>(), { template: null, cadence: undefined, length: null, siteLanguages: () => [], usedIds: () => [] })
const emit = defineEmits<{ use: [string] }>()
const { data: meta } = usePtMeta()

const q = ref('')
const topic = ref<string | null>(null)
const allLanguages = ref(false)
const cadence = ref<string | undefined>(props.cadence)
watch(() => props.cadence, (v) => {
  cadence.value = v
})
const seeMore = ref(false)
const { data, status } = useFetch<{ libraries: Library[] }>('/api/pt/libraries', {
  query: computed(() => ({ template: props.template ?? undefined, cadence: cadence.value, q: q.value || undefined })),
  key: computed(() => `pt-catalog-${props.template}-${cadence.value}-${q.value}`)
})

const topics = computed(() => [...new Set((data.value?.libraries ?? []).flatMap(l => l.topics))].sort())
const filtering = computed(() => !!q.value || !!topic.value || allLanguages.value)

function missing(lib: Library): string[] {
  return props.siteLanguages.filter(l => !lib.languages.includes(l))
}

function covers(lib: Library): boolean {
  return !props.length || lib.entry_count >= props.length
}

function score(lib: Library): number {
  const langs = props.siteLanguages.length ? 1 - missing(lib).length / props.siteLanguages.length : 1
  return (lib.suggested ? 5 : 0) + langs * 2 + (props.length && covers(lib) ? 2 : 0)
}

const editionOrder = (a: Library, b: Library) => (b.edition ?? '').localeCompare(a.edition ?? '', undefined, { numeric: true })

const cards = computed<Card[]>(() => {
  const libs = (data.value?.libraries ?? []).filter(l => (!topic.value || l.topics.includes(topic.value)) && (!allLanguages.value || !missing(l).length))
  const series = new Map<string, Library[]>()
  const out: Card[] = []
  for (const lib of libs) {
    if (!lib.series) {
      out.push({ key: lib.id, lib, earlier: [], score: score(lib) })
      continue
    }
    const key = `${lib.owner_user_id ?? 'platform'}:${lib.series.toLowerCase()}`
    series.set(key, [...series.get(key) ?? [], lib])
  }
  for (const [key, editions] of series) {
    const [latest, ...earlier] = editions.sort(editionOrder)
    out.push({ key, lib: latest!, earlier, score: score(latest!) })
  }
  return out.sort((a, b) => b.score - a.score || a.lib.title.localeCompare(b.lib.title))
})

// The best match, the template's other libraries, then the rest behind "See
// more" when the best match is the template's. Filtering lists everything.
const layout = computed(() => {
  const all = cards.value
  if (!props.template || filtering.value || all.length < 2) return { hidden: 0, groups: [{ title: null, best: false, cards: all }] }
  const [best, ...rest] = all
  const suggested = rest.filter(c => c.lib.suggested)
  const others = rest.filter(c => !c.lib.suggested)
  const hidden = best!.lib.suggested && !seeMore.value ? others.length : 0
  return {
    hidden,
    groups: [
      { title: 'Best match for this campaign', best: true, cards: [best!] },
      { title: 'Also suggested', best: false, cards: suggested },
      { title: 'More libraries', best: false, cards: hidden ? [] : others }
    ].filter(g => g.cards.length)
  }
})

// Why the best match fits, from what the campaign asks for.
function reason(lib: Library): string {
  const parts: string[] = []
  if (lib.suggested) parts.push('Made for this kind of campaign')
  if (props.siteLanguages.length > 1 && !missing(lib).length) parts.push('in all your languages')
  if (props.length && covers(lib)) parts.push(`covers all ${props.length} ${ptUnit(lib.cadence)}s`)
  const text = parts.join(', ')
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.` : ''
}

const expanded = ref(new Set<string>())
function editionsOpen(card: Card): boolean {
  return expanded.value.has(card.key) || card.earlier.some(l => props.usedIds.includes(l.id))
}
function toggleEditions(card: Card) {
  const next = new Set(expanded.value)
  if (!next.delete(card.key)) next.add(card.key)
  expanded.value = next
}

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

function coverage(lib: Library): string {
  if (!props.siteLanguages.length) return lib.languages.map(l => languageName(meta.value, l)).join(', ')
  const have = props.siteLanguages.filter(l => lib.languages.includes(l))
  return `${have.length}/${props.siteLanguages.length} of your languages`
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
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
      <UCheckbox
        v-if="siteLanguages.length"
        v-model="allLanguages"
        :label="siteLanguages.length > 1 ? 'In all my languages' : 'In my language'"
      />
    </div>
    <div
      v-if="topics.length > 1"
      class="flex flex-wrap gap-2"
    >
      <UButton
        v-for="t in topics"
        :key="t"
        size="xs"
        :color="topic === t ? 'primary' : 'neutral'"
        :variant="topic === t ? 'solid' : 'outline'"
        :label="t.charAt(0).toUpperCase() + t.slice(1)"
        @click="topic = topic === t ? null : t"
      />
    </div>
    <div
      v-if="status === 'pending' && !data"
      class="text-sm text-(--ui-text-muted)"
    >
      Loading…
    </div>
    <div
      v-else-if="!cards.length"
      class="text-sm text-(--ui-text-muted)"
    >
      No libraries match. You can write your own content instead.
    </div>
    <div
      v-for="group in layout.groups"
      :key="group.title ?? 'all'"
      class="space-y-2"
    >
      <h3
        v-if="group.title"
        class="text-sm font-semibold text-(--ui-text-muted)"
      >
        {{ group.title }}
      </h3>
      <UCard :ui="{ root: group.best ? 'ring-2 ring-(--ui-primary)' : '', body: 'p-0 sm:p-0 divide-y divide-(--ui-border)' }">
        <div
          v-for="card in group.cards"
          :key="card.key"
        >
          <div
            v-for="(lib, i) in [card.lib, ...(editionsOpen(card) ? card.earlier : [])]"
            :key="lib.id"
            class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-4 py-3"
            :class="i ? 'border-t border-(--ui-border) bg-(--ui-bg-muted) ps-8' : ''"
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
                  v-else-if="lib.role"
                  label="Shared with you"
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
                v-if="group.best && !i && reason(lib)"
                class="text-sm text-(--ui-primary)"
              >
                {{ reason(lib) }}
              </p>
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
                v-if="!covers(lib)"
                class="text-xs text-(--ui-warning)"
              >
                Covers {{ lib.entry_count }} of your campaign's {{ length }} {{ ptUnit(lib.cadence) }}s
              </p>
              <p
                v-if="missing(lib).length"
                class="text-xs text-(--ui-warning)"
              >
                Not yet in {{ missing(lib).map(l => languageName(meta, l)).join(', ') }}
              </p>
              <UButton
                v-if="!i && card.earlier.length"
                size="sm"
                variant="soft"
                color="primary"
                class="mt-1.5"
                icon="i-lucide-layers"
                :trailing-icon="editionsOpen(card) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                :label="`${editionsOpen(card) ? 'Hide' : 'Show'} ${card.earlier.length} earlier edition${card.earlier.length === 1 ? '' : 's'} (${card.earlier.map(l => l.edition ?? l.title).join(', ')})`"
                @click="toggleEditions(card)"
              />
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
        </div>
      </UCard>
    </div>
    <UButton
      v-if="layout.hidden"
      variant="soft"
      color="neutral"
      trailing-icon="i-lucide-chevron-down"
      :label="`See more (${layout.hidden})`"
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
