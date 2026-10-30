<script setup lang="ts">
// The live site in a frame beside the landing page editor. The frame renders
// the editor's unsaved changes and reports which section was clicked. With
// `campaignSlug` it shows that side campaign's landing page.
const props = defineProps<{ siteUrl: string, campaignSlug?: string, lang: string, defaultLanguage: string, draft: unknown }>()
const emit = defineEmits<{ select: [section: string, id?: string], defaults: [defaults: Record<string, string>] }>()

const DEVICES = { desktop: 1280, mobile: 390 } as const
const device = ref<keyof typeof DEVICES>('desktop')

const { data: editor, refresh } = useFetch<{ token: string }>('/api/pt/site/editor', { key: 'pt-landing-editor' })
const origin = computed(() => new URL(props.siteUrl).origin)
const pagePath = computed(() => `${props.lang === props.defaultLanguage ? '' : `/${props.lang}`}${props.campaignSlug ? `/${props.campaignSlug}` : ''}`)
const src = computed(() => {
  if (!editor.value) return null
  return `${props.siteUrl}${pagePath.value || '/'}?pt_edit=${encodeURIComponent(editor.value.token)}`
})
const viewUrl = computed(() => `${props.siteUrl}${pagePath.value}`)

const frame = ref<HTMLIFrameElement>()
const ready = ref(false)
watch(src, () => {
  ready.value = false
})

function post(msg: Record<string, unknown>) {
  frame.value?.contentWindow?.postMessage({ source: 'pt-editor', ...msg }, origin.value)
}
function sendDraft() {
  if (ready.value) post({ type: 'draft', ...JSON.parse(JSON.stringify(props.draft)) })
}
let timer: ReturnType<typeof setTimeout> | undefined
watch(() => props.draft, () => {
  clearTimeout(timer)
  timer = setTimeout(sendDraft, 300)
}, { deep: true })

function onMessage(e: MessageEvent) {
  if (e.origin !== origin.value || e.source !== frame.value?.contentWindow || e.data?.source !== 'pt-preview') return
  if (e.data.type === 'ready') {
    ready.value = true
    emit('defaults', (e.data.defaults ?? {}) as Record<string, string>)
    sendDraft()
  } else if (e.data.type === 'select') {
    emit('select', String(e.data.section), e.data.id ? String(e.data.id) : undefined)
  } else if (e.data.type === 'expired') {
    void refresh()
  }
}
onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  clearTimeout(timer)
})

function focus(section: string, id?: string) {
  if (ready.value) post({ type: 'focus', section, id })
}
defineExpose({ focus })

// The frame renders at the device's width and scales down to fit.
const box = ref<HTMLElement>()
const boxSize = ref({ w: 0, h: 0 })
let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    if (entry) boxSize.value = { w: entry.contentRect.width, h: entry.contentRect.height }
  })
  if (box.value) observer.observe(box.value)
})
onBeforeUnmount(() => observer?.disconnect())
const frameWidth = computed(() => DEVICES[device.value])
const scale = computed(() => boxSize.value.w ? Math.min(1, boxSize.value.w / frameWidth.value) : 1)
</script>

<template>
  <div class="flex flex-col rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) overflow-hidden">
    <div class="flex items-center gap-2 border-b border-(--ui-border) bg-(--ui-bg) px-3 py-2">
      <UIcon
        name="i-lucide-mouse-pointer-click"
        class="size-4 shrink-0 text-(--ui-text-muted)"
      />
      <p class="flex-1 truncate text-xs text-(--ui-text-muted)">
        Preview with your unsaved changes. Click a section to edit it.
      </p>
      <UFieldGroup size="xs">
        <UButton
          icon="i-lucide-monitor"
          aria-label="Desktop"
          :variant="device === 'desktop' ? 'solid' : 'outline'"
          color="neutral"
          @click="device = 'desktop'"
        />
        <UButton
          icon="i-lucide-smartphone"
          aria-label="Phone"
          :variant="device === 'mobile' ? 'solid' : 'outline'"
          color="neutral"
          @click="device = 'mobile'"
        />
      </UFieldGroup>
      <UButton
        :href="viewUrl"
        target="_blank"
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-lucide-external-link"
        aria-label="Open the page in a new tab"
      />
    </div>
    <div
      ref="box"
      class="relative flex-1 min-h-0"
    >
      <div
        class="relative mx-auto h-full overflow-hidden bg-white"
        :class="{ 'shadow-lg': device === 'mobile' }"
        :style="{ width: `${frameWidth * scale}px` }"
      >
        <iframe
          v-if="src"
          ref="frame"
          :src="src"
          title="Landing page preview"
          class="absolute top-0 left-0 origin-top-left border-0"
          :style="{ width: `${frameWidth}px`, height: `${boxSize.h / scale}px`, transform: `scale(${scale})` }"
        />
      </div>
      <div
        v-if="!ready"
        class="absolute inset-0 flex items-center justify-center"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="size-6 animate-spin text-(--ui-text-muted)"
        />
      </div>
    </div>
  </div>
</template>
