<script setup lang="ts">
// Library catalog, ranked by fit with the campaign: the template's libraries,
// the site's languages and how close its length is to the campaign's. Shows
// the best match first, the template's other libraries next, then the rest; a series
// shows its newest edition with the earlier ones a click away. Filters by
// topic, language, cadence and text. The preview opens on the library's
// details, then its entries day by day. Emits
// the chosen library id.
interface Library {
  id: string
  owner_user_id: string | null
  title: string
  description: string | null
  cadence: 'daily' | 'weekly'
  entry_count: number
  languages: string[]
  source_language: string
  topics: string[]
  template_keys: string[]
  series: string | null
  edition: string | null
  license: string
  license_note: string | null
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

// 1 when the library is as long as the campaign, towards 0 the further off it is.
function lengthFit(lib: Library): number {
  if (!props.length) return 0
  return 1 - Math.abs(lib.entry_count - props.length) / Math.max(lib.entry_count, props.length)
}

// Made for another time of year, e.g. a Ramadan guide outside a Ramadan
// campaign: never the best match, and listed last.
const seasonal = computed(() => new Set((meta.value?.templates ?? []).filter(t => t.seasonal).map(t => t.key)))
function offSeason(lib: Library): boolean {
  return !!props.template && !lib.suggested && lib.template_keys.some(k => seasonal.value.has(k))
}

function score(lib: Library): number {
  if (offSeason(lib)) return -1
  const langs = props.siteLanguages.length ? 1 - missing(lib).length / props.siteLanguages.length : 1
  return (lib.suggested ? 5 : 0) + langs * 2 + lengthFit(lib) * 2
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

// The best match, the template's other libraries, then the rest. Filtering
// lists everything in one list.
const groups = computed(() => {
  const all = cards.value
  if (!props.template || filtering.value || all.length < 2) return [{ title: null, best: false, cards: all }]
  const best = offSeason(all[0]!.lib) ? null : all[0]!
  const rest = all.filter(c => c !== best)
  return [
    { title: 'Best match for this campaign', best: true, cards: best ? [best] : [] },
    { title: best ? 'Also suggested' : 'Suggested', best: false, cards: rest.filter(c => c.lib.suggested) },
    { title: 'More libraries', best: false, cards: rest.filter(c => !c.lib.suggested) }
  ].filter(g => g.cards.length)
})

// Why the best match fits, from what the campaign asks for.
function reason(lib: Library): string {
  const parts: string[] = []
  if (lib.suggested) parts.push('Made for this kind of campaign')
  if (props.siteLanguages.length > 1 && !missing(lib).length) parts.push('in all your languages')
  if (props.length && lib.entry_count === props.length) parts.push(`${props.length} ${ptUnit(lib.cadence)}s like your campaign`)
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

const preview = reactive({ open: false, lib: null as Library | null, tab: 'details', day: 1, lang: 'en', doc: null as Record<string, any> | null, loading: false })

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
  preview.tab = 'details'
  preview.day = 1
  preview.doc = null
  preview.lang = lib.languages.find(l => props.siteLanguages.includes(l)) ?? lib.languages[0] ?? 'en'
  preview.open = true
}

const previewUnit = computed(() => preview.lib?.cadence === 'weekly' ? 'week' : 'day')
function showDays() {
  preview.tab = 'days'
  if (!preview.doc) loadPreview()
}
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
                class="text-xs text-(--ui-text-muted)"
              >
                Your campaign has {{ length }} {{ ptUnit(lib.cadence) }}s
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

    <UModal
      v-model:open="preview.open"
      :title="preview.lib?.title"
      :ui="{ content: 'max-w-2xl' }"
    >
      <template #body>
        <div class="space-y-3">
          <UTabs
            :model-value="preview.tab"
            :items="[{ label: 'Details', value: 'details', icon: 'i-lucide-info' }, { label: 'Prayers', value: 'days', icon: 'i-lucide-book-open' }]"
            :content="false"
            variant="link"
            @update:model-value="(v) => v === 'days' ? showDays() : preview.tab = 'details'"
          />
          <div
            v-if="preview.tab === 'days'"
            class="flex gap-2 items-center"
          >
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
            v-if="preview.tab === 'details' && preview.lib"
            class="space-y-5"
          >
            <p
              v-if="preview.lib.description"
              class="whitespace-pre-line"
            >
              {{ preview.lib.description }}
            </p>
            <dl class="grid sm:grid-cols-[9rem_1fr] gap-x-4 gap-y-1 sm:gap-y-4 text-sm">
              <dt class="font-medium text-(--ui-text-muted)">
                Length
              </dt>
              <dd class="mb-3 sm:mb-0">
                {{ preview.lib.entry_count }} {{ previewUnit }}s, a new entry every {{ previewUnit }}
                <p
                  v-if="!covers(preview.lib)"
                  class="text-(--ui-text-muted)"
                >
                  Your campaign has {{ length }} {{ previewUnit }}s.
                </p>
              </dd>
              <dt class="font-medium text-(--ui-text-muted)">
                Languages
              </dt>
              <dd class="mb-3 sm:mb-0 space-y-1.5">
                <div class="flex flex-wrap gap-1.5">
                  <UBadge
                    v-for="l in preview.lib.languages"
                    :key="l"
                    :label="l === preview.lib.source_language ? `${languageName(meta, l)} (original)` : languageName(meta, l)"
                    :icon="siteLanguages.includes(l) ? 'i-lucide-check' : undefined"
                    :color="siteLanguages.includes(l) ? 'success' : 'neutral'"
                    variant="subtle"
                  />
                </div>
                <p
                  v-if="missing(preview.lib).length"
                  class="text-(--ui-warning)"
                >
                  Not yet in {{ missing(preview.lib).map(l => languageName(meta, l)).join(', ') }}.
                </p>
              </dd>
              <template v-if="preview.lib.series">
                <dt class="font-medium text-(--ui-text-muted)">
                  Series
                </dt>
                <dd class="mb-3 sm:mb-0">
                  {{ preview.lib.series }}<template v-if="preview.lib.edition">
                    · {{ preview.lib.edition }} edition
                  </template>
                </dd>
              </template>
              <template v-if="preview.lib.topics.length">
                <dt class="font-medium text-(--ui-text-muted)">
                  Topics
                </dt>
                <dd class="mb-3 sm:mb-0 flex flex-wrap gap-1.5">
                  <UBadge
                    v-for="t in preview.lib.topics"
                    :key="t"
                    :label="t"
                    color="neutral"
                    variant="outline"
                  />
                </dd>
              </template>
              <template v-if="preview.lib.credit">
                <dt class="font-medium text-(--ui-text-muted)">
                  By
                </dt>
                <dd class="mb-3 sm:mb-0">
                  {{ preview.lib.credit }}
                </dd>
              </template>
              <dt class="font-medium text-(--ui-text-muted)">
                License
              </dt>
              <dd>
                {{ PT_LABELS.license[preview.lib.license] ?? preview.lib.license }}
                <p
                  v-if="preview.lib.license_note"
                  class="text-xs text-(--ui-text-muted) mt-1"
                >
                  {{ preview.lib.license_note }}
                </p>
              </dd>
            </dl>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <UButton
                label="Read the prayers"
                trailing-icon="i-lucide-arrow-right"
                variant="soft"
                @click="showDays"
              />
              <UButton
                v-if="!usedIds.includes(preview.lib.id)"
                icon="i-lucide-plus"
                label="Use"
                @click="emit('use', preview.lib.id); preview.open = false"
              />
              <UBadge
                v-else
                color="success"
                variant="subtle"
                icon="i-lucide-check"
                label="In use"
                size="lg"
              />
            </div>
          </div>
          <div
            v-else-if="preview.loading"
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
