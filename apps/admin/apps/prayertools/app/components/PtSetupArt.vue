<script setup lang="ts">
// A small picture for a setup choice card: how the public site shows progress
// towards each goal, and the shape of each kind of campaign on a timeline.
defineProps<{ name: string }>()

const CAPTIONS: Record<string, string> = {
  prayer_time: '14 of 24 hours today',
  people: '63 of 100 people',
  coverage: '88% of the time covered'
}
// Hours nobody has taken in the 24/7 coverage picture.
const OPEN_HOURS = [3, 4, 16]
// Where each person's bar starts in the start-anytime picture.
const JOINS = [{ x: 6, y: 3.5 }, { x: 30, y: 10 }, { x: 54, y: 16.5 }]
</script>

<template>
  <span
    aria-hidden="true"
    class="block max-w-52"
  >
    <span class="flex items-center h-5">
      <span
        v-if="name === 'prayer_time'"
        class="block w-full h-2.5 rounded-full overflow-hidden bg-(--ui-bg-accented)"
      >
        <span class="block h-full w-[58%] rounded-full bg-(--ui-primary)" />
      </span>
      <svg
        v-else-if="name === 'people'"
        viewBox="0 0 118 14"
        class="h-4 w-auto"
      >
        <g
          v-for="i in 10"
          :key="i"
          :transform="`translate(${(i - 1) * 12} 0)`"
          :class="i <= 6 ? 'fill-(--ui-primary)' : 'fill-(--ui-bg-accented)'"
        >
          <circle
            cx="5"
            cy="3.5"
            r="3"
          />
          <path d="M0 14a5 5 0 0 1 10 0z" />
        </g>
      </svg>
      <span
        v-else-if="name === 'coverage'"
        class="grid grid-cols-12 gap-0.5 w-full"
      >
        <span
          v-for="h in 24"
          :key="h"
          class="h-2 rounded-xs"
          :class="OPEN_HOURS.includes(h) ? 'bg-(--ui-bg-accented)' : 'bg-(--ui-primary)'"
        />
      </span>
      <svg
        v-else
        viewBox="0 0 120 20"
        class="h-5 w-auto fill-(--ui-primary) stroke-(--ui-primary)"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="3"
      >
        <template v-if="name === 'fixed'">
          <path
            d="M6 10H114"
            class="stroke-(--ui-bg-accented)"
          />
          <path d="M6 10H74" />
          <circle
            cx="6"
            cy="10"
            r="3"
          />
          <circle
            cx="74"
            cy="10"
            r="3"
          />
        </template>
        <template v-else-if="name === 'ongoing'">
          <path d="M6 10H110" />
          <path
            d="M103 4l8 6-8 6"
            fill="none"
          />
          <circle
            cx="6"
            cy="10"
            r="3"
          />
        </template>
        <template v-else-if="name === 'anytime'">
          <g
            v-for="j in JOINS"
            :key="j.x"
            stroke-width="2.5"
          >
            <path :d="`M${j.x} ${j.y}h56`" />
            <circle
              :cx="j.x"
              :cy="j.y"
              r="1.5"
            />
          </g>
        </template>
      </svg>
    </span>
    <span
      v-if="CAPTIONS[name]"
      class="block mt-1 text-xs text-(--ui-text-muted)"
    >{{ CAPTIONS[name] }}</span>
  </span>
</template>
