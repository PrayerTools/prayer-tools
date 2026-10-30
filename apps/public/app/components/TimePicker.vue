<script setup lang="ts">
// HH:MM time field. Phones get the native time input (wheel / clock); other
// devices get a clock face in a modal with an AM/PM toggle.
import { formatTime } from '~/utils/commitment'

defineOptions({ inheritAttrs: false })

const model = defineModel<string>({ required: true })
const props = defineProps<{ lang: string, placeholder?: string }>()
const { t } = useI18n()

// Set after mount so the server render and hydration agree.
const isMobile = ref(false)
onMounted(() => {
  isMobile.value = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
})

const open = ref(false)
const selectingHours = ref(true)
const hour12 = ref(9)
const minute = ref(0)
const period = ref<'AM' | 'PM'>('AM')

const hours12 = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const minuteMarkers = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]

const displayTime = computed(() => model.value ? formatTime(model.value, props.lang) : '')

// The locale's own words for AM and PM.
const periodLabels = computed(() => {
  const label = (h: number) => {
    try {
      return new Intl.DateTimeFormat(props.lang, { hour: 'numeric', hourCycle: 'h12', timeZone: 'UTC' })
        .formatToParts(new Date(Date.UTC(2024, 0, 1, h)))
        .find(p => p.type === 'dayPeriod')?.value
    } catch {
      return undefined
    }
  }
  return { AM: label(9) ?? 'AM', PM: label(21) ?? 'PM' }
})

const handRotation = computed(() => selectingHours.value ? (hour12.value % 12) * 30 : minute.value * 6)

function positionStyle(value: number, total: number) {
  const angle = (value / total) * 360 - 90
  const radius = 100
  const x = 128 + radius * Math.cos((angle * Math.PI) / 180)
  const y = 128 + radius * Math.sin((angle * Math.PI) / 180)
  return { left: `${x}px`, top: `${y}px` }
}

function selectHour(hour: number) {
  hour12.value = hour
  setTimeout(() => { selectingHours.value = false }, 150)
}

watch(open, (isOpen) => {
  if (!isOpen) return
  if (model.value) {
    const [h = 0, m = 0] = model.value.split(':').map(Number)
    hour12.value = h % 12 || 12
    minute.value = m
    period.value = h >= 12 ? 'PM' : 'AM'
  }
  selectingHours.value = true
})

function confirm() {
  const h = (hour12.value % 12) + (period.value === 'PM' ? 12 : 0)
  model.value = `${String(h).padStart(2, '0')}:${String(minute.value).padStart(2, '0')}`
  open.value = false
}
</script>

<template>
  <UInput v-if="isMobile" v-model="model" type="time" v-bind="$attrs" />

  <div v-else>
    <UInput
      :model-value="displayTime"
      type="text"
      readonly
      :placeholder="placeholder ?? t('commitment.time_placeholder')"
      class="cursor-pointer"
      v-bind="$attrs"
      @click="open = true"
      @keydown.enter.prevent="open = true"
      @keydown.space.prevent="open = true"
    >
      <template #trailing>
        <UIcon name="i-lucide-clock" class="size-4 text-muted cursor-pointer" @click.stop="open = true" />
      </template>
    </UInput>

    <UModal v-model:open="open" :title="t('commitment.time')">
      <template #content>
        <div class="p-6">
          <div class="flex items-center justify-center gap-2 mb-6" dir="ltr">
            <button
              type="button"
              class="text-5xl font-light transition-opacity"
              :class="selectingHours ? 'opacity-100' : 'opacity-40'"
              @click="selectingHours = true"
            >
              {{ String(hour12).padStart(2, '0') }}
            </button>
            <span class="text-5xl font-light">:</span>
            <button
              type="button"
              class="text-5xl font-light transition-opacity"
              :class="!selectingHours ? 'opacity-100' : 'opacity-40'"
              @click="selectingHours = false"
            >
              {{ String(minute).padStart(2, '0') }}
            </button>
            <div class="flex flex-col ms-4 gap-1">
              <button
                v-for="p in (['AM', 'PM'] as const)"
                :key="p"
                type="button"
                class="px-2 py-1 text-sm font-medium rounded transition-all"
                :class="period === p ? 'bg-inverted text-inverted' : 'text-muted hover:text-default'"
                @click="period = p"
              >
                {{ periodLabels[p] }}
              </button>
            </div>
          </div>

          <div class="relative w-64 h-64 mx-auto mb-6" dir="ltr">
            <div class="absolute inset-0 rounded-full bg-elevated border border-default" />
            <div
              class="absolute left-1/2 top-1/2 w-0.5 bg-inverted rounded-full transition-transform duration-150"
              :style="{ height: '80px', transformOrigin: 'center bottom', transform: `translateX(-50%) translateY(-100%) rotate(${handRotation}deg)` }"
            />
            <div class="absolute top-1/2 left-1/2 w-3 h-3 -mt-1.5 -ml-1.5 rounded-full bg-inverted" />

            <template v-if="selectingHours">
              <button
                v-for="hour in hours12"
                :key="hour"
                type="button"
                class="absolute w-10 h-10 -mt-5 -ml-5 flex items-center justify-center rounded-full text-sm font-medium transition-all"
                :class="hour12 === hour ? 'bg-inverted text-inverted' : 'hover:bg-accented'"
                :style="positionStyle(hour, 12)"
                @click="selectHour(hour)"
              >
                {{ hour }}
              </button>
            </template>
            <template v-else>
              <button
                v-for="m in minuteMarkers"
                :key="m"
                type="button"
                class="absolute w-10 h-10 -mt-5 -ml-5 flex items-center justify-center rounded-full text-sm font-medium transition-all"
                :class="minute === m ? 'bg-inverted text-inverted' : 'hover:bg-accented'"
                :style="positionStyle(m, 60)"
                @click="minute = m"
              >
                {{ String(m).padStart(2, '0') }}
              </button>
            </template>
          </div>

          <div class="flex justify-end gap-2 pt-4 border-t border-default">
            <UButton variant="ghost" color="neutral" :label="t('common.cancel')" @click="open = false" />
            <UButton :label="t('common.ok')" @click="confirm" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
