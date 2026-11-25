<script setup lang="ts">
// A countdown pinned under the site header while the person reads the prayer
// guide. Its length is the one they last picked here (kept in this browser),
// else how long they said they would pray (`personMinutes`), else the
// campaign's default. It shows whole minutes left, with a ring that fills as
// the time passes and four dots that slowly come on in turn so it visibly
// runs, and chimes and vibrates when time is up.
const props = defineProps<{ personMinutes: number | null }>()
const { site, num, minutes: minutesLabel } = useSite()
const { t } = useI18n()

const FALLBACK_LENGTHS = [5, 10, 15, 20, 30, 45, 60]
const lengthKey = computed(() => `pt_timer:${site.value.orgId}`)
const soundKey = computed(() => `pt_timer_sound:${site.value.orgId}`)

const picked = ref<number | null>(null)
const sound = ref(true)
const reducedMotion = ref(false)
onMounted(() => {
  reducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  try {
    const n = Number(localStorage.getItem(lengthKey.value))
    if (Number.isInteger(n) && n > 0 && n <= 240) picked.value = n
    sound.value = localStorage.getItem(soundKey.value) !== 'off'
  } catch {
    // storage blocked
  }
})

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage blocked
  }
}

const length = computed(() => picked.value ?? props.personMinutes ?? site.value.campaign?.defaultDuration ?? 15)
const lengths = computed(() => {
  const own = site.value.campaign?.durations ?? []
  return [...new Set([...(own.length ? own : FALLBACK_LENGTHS), length.value])].sort((a, b) => a - b)
})

// Counts down to an end time, so a throttled background tab still shows the right time.
const remaining = ref<number | null>(null)
const endsAt = ref<number | null>(null)
let tick: ReturnType<typeof setInterval> | null = null
const running = computed(() => endsAt.value !== null)
const done = computed(() => remaining.value === 0)
const totalMs = computed(() => length.value * 60_000)
const shownMs = computed(() => remaining.value ?? totalMs.value)
const minutesLeft = computed(() => Math.ceil(shownMs.value / 60_000))
const label = computed(() => done.value ? t('pray.timer_done') : t('pray.timer_min', { n: num(minutesLeft.value) }))
// How far through the prayer time, 0 to 1; whole minutes only when motion is reduced.
const progress = computed(() => {
  const elapsed = totalMs.value - shownMs.value
  return Math.min(1, (reducedMotion.value ? Math.floor(elapsed / 60_000) * 60_000 : elapsed) / totalMs.value)
})

function stopTick() {
  if (tick) clearInterval(tick)
  tick = null
}

function update() {
  if (endsAt.value === null) return
  remaining.value = Math.max(0, endsAt.value - Date.now())
  if (remaining.value === 0) {
    endsAt.value = null
    stopTick()
    timeUp()
  }
}

// The chime is made in the browser, and its audio is started from the click
// that starts the timer, which browsers require before sound can play later.
let audio: AudioContext | null = null
function prepareAudio() {
  try {
    audio ??= new AudioContext()
    void audio.resume()
  } catch {
    audio = null
  }
}

function chime() {
  if (!audio) return
  const start = audio.currentTime + 0.05
  for (const [i, freq] of [659.25, 880].entries()) {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    const at = start + i * 0.35
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(0.18, at + 0.04)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.6)
    osc.connect(gain).connect(audio.destination)
    osc.start(at)
    osc.stop(at + 1.7)
  }
}

function timeUp() {
  if (sound.value) chime()
  navigator.vibrate?.([200, 120, 200])
}

function toggle() {
  if (running.value) {
    update()
    endsAt.value = null
    stopTick()
    return
  }
  prepareAudio()
  const from = done.value || remaining.value === null ? totalMs.value : remaining.value
  endsAt.value = Date.now() + from
  update()
  tick = setInterval(update, 1000)
}

function choose(n: number) {
  picked.value = n
  endsAt.value = null
  remaining.value = null
  stopTick()
  store(lengthKey.value, String(n))
}

const menu = computed(() => [
  lengths.value.map(n => ({ label: minutesLabel(n), icon: n === length.value ? 'i-lucide-check' : undefined, onSelect: () => choose(n) })),
  [{
    label: t('pray.timer_sound'),
    type: 'checkbox' as const,
    checked: sound.value,
    onUpdateChecked: (v: boolean) => {
      sound.value = v
      store(soundKey.value, v ? 'on' : 'off')
    },
    onSelect: (e: Event) => e.preventDefault()
  }]
])

const ariaLabel = computed(() => done.value ? t('pray.timer_restart') : running.value ? t('pray.timer_pause') : t('pray.timer_start'))
const icon = computed(() => done.value ? 'i-lucide-check' : running.value ? 'i-lucide-pause' : 'i-lucide-play')

onBeforeUnmount(() => {
  stopTick()
  void audio?.close()
})
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 top-18 z-30 print:hidden">
    <div class="max-w-5xl mx-auto px-4 flex justify-end">
      <UFieldGroup class="pointer-events-auto rounded-full shadow-lg">
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-s-full ps-2 pe-3 py-1 text-sm font-semibold tabular-nums"
          :class="done ? 'bg-success text-inverted' : 'bg-primary text-inverted'"
          :aria-label="ariaLabel"
          @click="toggle"
        >
          <span class="relative grid size-7 place-items-center">
            <svg viewBox="0 0 36 36" class="absolute inset-0 size-full -rotate-90" aria-hidden="true">
              <circle cx="18" cy="18" r="15.9155" fill="none" stroke="currentColor" stroke-width="3" stroke-opacity="0.3" />
              <circle cx="18" cy="18" r="15.9155" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" :stroke-dasharray="`${progress * 100} 100`" :class="!reducedMotion && 'transition-[stroke-dasharray] duration-1000 ease-linear'" />
            </svg>
            <UIcon :name="icon" class="relative size-3.5" />
          </span>
          <span class="flex flex-col items-center gap-1 leading-none">
            <span>{{ label }}</span>
            <span class="flex gap-1" aria-hidden="true">
              <span v-for="n in 4" :key="n" class="size-1 rounded-full bg-current" :class="running ? (reducedMotion ? 'opacity-90' : `pt-dot-fill-${n}`) : 'opacity-30'" />
            </span>
          </span>
        </button>
        <UDropdownMenu :items="menu" :content="{ align: 'end' }">
          <UButton
            icon="i-lucide-chevron-down"
            :color="done ? 'success' : 'primary'"
            :aria-label="t('pray.timer_length')"
            class="rounded-e-full pe-3"
          />
        </UDropdownMenu>
      </UFieldGroup>
    </div>
  </div>
</template>
