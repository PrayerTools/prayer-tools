<script setup lang="ts">
// The embed code for one campaign in one language, with the live widget in a
// frame. The default language and the current campaign are left out of the
// code, so the widget follows the site's default and its next campaign.
const props = defineProps<{
  siteUrl: string
  campaignSegment: string | null
  languages: string[]
  defaultLanguage: string
  // Whether the site and the campaign are published, so the widget loads.
  live: boolean
}>()

const { data: meta } = usePtMeta()
const toast = usePtToast()

const lang = ref(props.defaultLanguage)
watch(() => props.defaultLanguage, (l) => {
  lang.value = l
})
const langItems = computed(() => props.languages.map(l => ({ label: languageName(meta.value, l), value: l })))

const langSegment = computed(() => lang.value === props.defaultLanguage ? null : lang.value)
const snippet = computed(() => {
  const attrs = [`src="${props.siteUrl}/embed.js"`]
  if (langSegment.value) attrs.push(`data-lang="${langSegment.value}"`)
  if (props.campaignSegment) attrs.push(`data-campaign="${props.campaignSegment}"`)
  return `<script ${attrs.join(' ')}></${'script'}>`
})
const embedUrl = computed(() => `${props.siteUrl}/${[langSegment.value, props.campaignSegment, 'embed'].filter(Boolean).join('/')}`)

const frame = ref<HTMLIFrameElement>()
const height = ref(240)
function onMessage(e: MessageEvent) {
  if (e.source !== frame.value?.contentWindow || e.data?.type !== 'pt-embed-height') return
  const h = Number(e.data.height)
  if (h > 0 && h < 5000) height.value = h
}
onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))

async function copy() {
  await navigator.clipboard.writeText(snippet.value)
  toast.ok('Embed code copied')
}
</script>

<template>
  <div class="space-y-4">
    <UCard>
      <template #header>
        <h2 class="font-semibold">
          Embed code
          <InfoTip>
            <p>Paste this where the widget should appear on your website, church page or blog.</p>
            <p>People sign up right in the widget. On 24/7 campaigns the widget links to your site, where they choose an hour on the coverage picker.</p>
            <p>Confirmation emails and prayer-time links open your site as usual.</p>
          </InfoTip>
        </h2>
      </template>
      <div class="space-y-3">
        <UFormField
          v-if="langItems.length > 1"
          label="Language"
        >
          <USelect
            v-model="lang"
            :items="langItems"
            class="w-44"
          />
        </UFormField>
        <div class="flex items-start gap-2">
          <UTextarea
            :model-value="snippet"
            readonly
            :rows="2"
            autoresize
            class="flex-1 font-mono"
            aria-label="Embed code"
          />
          <UButton
            icon="i-lucide-copy"
            aria-label="Copy embed code"
            @click="copy"
          />
        </div>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-semibold">
          Preview
          <InfoTip text="The live widget. A signup here is a real signup." />
        </h2>
      </template>
      <div
        v-if="live"
        class="rounded-md border border-(--ui-border) bg-white overflow-hidden max-w-[640px]"
      >
        <iframe
          ref="frame"
          :key="embedUrl"
          :src="embedUrl"
          title="Embed preview"
          class="block w-full border-0"
          :style="{ height: `${height}px` }"
        />
      </div>
      <p
        v-else
        class="text-sm text-(--ui-text-muted)"
      >
        The preview shows once the site and this campaign are published.
      </p>
    </UCard>
  </div>
</template>
