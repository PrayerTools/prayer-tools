<script setup lang="ts">
// Picks the site's location (the prayed-for place and its coordinates) with a
// place search. Searching happens on demand (Enter or the button), not per keystroke.
export interface PtLocation {
  name: string
  latitude: number | null
  longitude: number | null
}

const model = defineModel<PtLocation | null>({ default: null })

interface Place { name: string, label: string, kind: string | null, latitude: number, longitude: number }

const query = ref(model.value?.name ?? '')
watch(() => model.value?.name, (name) => {
  if (name) query.value = name
})
const places = ref<Place[]>([])
const searching = ref(false)
const searched = ref(false)
const error = ref('')

async function search() {
  if (query.value.trim().length < 2) return
  searching.value = true
  error.value = ''
  try {
    const res = await $fetch<{ places: Place[] }>('/api/pt/sites/geocode', { query: { q: query.value } })
    places.value = res.places
    searched.value = true
  } catch (err) {
    error.value = ptErrorMessage(err)
  } finally {
    searching.value = false
  }
}

function pick(p: Place) {
  model.value = { name: p.name, latitude: p.latitude, longitude: p.longitude }
  query.value = p.name
  places.value = []
  searched.value = false
}

function useTyped() {
  const name = query.value.trim()
  model.value = name ? { name, latitude: null, longitude: null } : null
  places.value = []
  searched.value = false
}

function clear() {
  model.value = null
  query.value = ''
  places.value = []
  searched.value = false
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex gap-2">
      <UInput
        v-model="query"
        placeholder="Search for a city, region or country"
        icon="i-lucide-map-pin"
        class="flex-1"
        @keydown.enter.prevent="search"
      />
      <UButton
        color="neutral"
        variant="solid"
        size="lg"
        icon="i-lucide-search"
        class="min-h-10 rounded-lg bg-[#202833] px-5 font-semibold text-white hover:bg-[#354353]"
        :loading="searching"
        label="Search"
        @click="search"
      />
    </div>
    <p
      v-if="error"
      class="text-sm text-(--ui-error)"
    >
      {{ error }}
    </p>
    <ul
      v-if="places.length"
      class="rounded-md border border-(--ui-border) divide-y divide-(--ui-border)"
    >
      <li
        v-for="p in places"
        :key="`${p.latitude},${p.longitude}`"
      >
        <button
          type="button"
          class="w-full text-start px-3 py-2 hover:bg-(--ui-bg-elevated)"
          @click="pick(p)"
        >
          <div class="font-medium text-sm">
            {{ p.name }}
          </div>
          <div class="text-xs text-(--ui-text-muted) truncate">
            {{ p.label }}
          </div>
        </button>
      </li>
    </ul>
    <div
      v-if="searched && !places.length"
      class="text-sm text-(--ui-text-muted)"
    >
      No places found.
      <UButton
        variant="link"
        size="sm"
        :label="`Use “${query}” without a map location`"
        @click="useTyped"
      />
    </div>
    <div
      v-if="model"
      class="flex items-center gap-2 text-sm"
    >
      <UIcon
        name="i-lucide-map-pin-check"
        class="text-(--ui-success)"
      />
      <span>{{ model.name }}</span>
      <span
        v-if="model.latitude !== null && model.longitude !== null"
        class="text-(--ui-text-muted)"
      >({{ model.latitude.toFixed(3) }}, {{ model.longitude.toFixed(3) }})</span>
      <UButton
        variant="ghost"
        color="neutral"
        size="xs"
        icon="i-lucide-x"
        aria-label="Clear location"
        @click="clear"
      />
    </div>
  </div>
</template>
