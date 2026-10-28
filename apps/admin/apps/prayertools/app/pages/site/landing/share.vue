<script setup lang="ts">
// Share, for the campaign chosen in the switcher: its live link, QR code (PNG
// and SVG), share messages per language with a WhatsApp preview, the share
// image for link previews, and the Give line.
import type { TranslatableText } from '@prayertools/shared/db/schema'

definePageMeta({ middleware: 'auth' })

const { data: site, can } = usePtSite()
const { data: meta } = usePtMeta()
const toast = usePtToast()
const { id: campaignId } = usePtCampaign()
const { data, refresh } = useFetch<{ url: string, qrPng: string, qrSvg: string, share: { messages?: TranslatableText }, shareImageUrl: string | null, languages: string[], defaultLanguage: string, donateUrl: string }>('/api/pt/share', {
  query: computed(() => ({ campaign: campaignId.value })),
  key: computed(() => `pt-share-${campaignId.value}`),
  immediate: false,
  watch: [campaignId]
})
watch(campaignId, (id) => {
  if (id) refresh()
}, { immediate: true })

const messages = ref<TranslatableText | null>(null)
watch(data, (d) => {
  messages.value = d?.share.messages ?? null
}, { immediate: true })
const lang = ref('en')
watch(data, (d) => {
  if (d) lang.value = d.defaultLanguage
}, { immediate: true })

const activeDomain = computed(() => site.value?.domains.some(d => d.status === 'active') ?? false)
const message = computed(() => messages.value?.values[lang.value] || `Pray with us: ${site.value?.org.name}`)
const shareText = computed(() => [message.value.trim(), data.value?.url ?? ''].filter(Boolean).join('\n'))
const whatsapp = computed(() => `https://wa.me/?text=${encodeURIComponent(shareText.value)}`)
const langItems = computed(() => (site.value?.site.languages ?? []).map(l => ({ label: languageName(meta.value, l), value: l })))
const langDir = computed(() => meta.value?.languages.find(l => l.code === lang.value)?.dir ?? 'ltr')

async function copy(text: string, what = 'Link') {
  await navigator.clipboard.writeText(text)
  toast.ok(`${what} copied`)
}
function download(href: string, filename: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}
function downloadPng() {
  if (data.value) download(data.value.qrPng, `${site.value?.org.slug}-qr.png`)
}
function downloadSvg() {
  const href = URL.createObjectURL(new Blob([data.value?.qrSvg ?? ''], { type: 'image/svg+xml' }))
  download(href, `${site.value?.org.slug}-qr.svg`)
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    await $fetch(`/api/pt/campaigns/${campaignId.value}`, { method: 'PATCH', body: { share: { ...(data.value?.share ?? {}), messages: messages.value } } })
    await refresh()
    toast.ok('Saved')
  } catch (err) {
    toast.fail(err)
  } finally {
    saving.value = false
  }
}

const pickingImage = ref(false)
async function setShareImage(url: string | undefined) {
  try {
    await $fetch(`/api/pt/campaigns/${campaignId.value}`, { method: 'PATCH', body: { share_image_url: url ?? null } })
    await refresh()
    toast.ok(url ? 'Share image saved' : 'Share image removed')
  } catch (err) {
    toast.fail(err)
  }
}
</script>

<template>
  <div
    v-if="data && site"
    class="max-w-4xl mx-auto space-y-6"
  >
    <PtLandingTabs />
    <header class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-bold">
        Share
        <InfoTip :text="`Invite people to pray with ${site.org.name}. Each campaign has its own link, message and image.`" />
      </h1>
      <PtCampaignSwitcher />
    </header>

    <UAlert
      v-if="site.site.status !== 'published'"
      color="warning"
      variant="subtle"
      icon="i-lucide-info"
      :title="site.site.status === 'draft' ? 'This site isn\'t published yet' : 'This site is archived'"
      :description="site.site.status === 'draft' ? 'The link works once you publish. You can prepare your share message and image now.' : 'The link shows a short “this campaign has ended” page.'"
    />

    <div class="grid gap-4 md:grid-cols-2">
      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Link
          </h2>
        </template>
        <div class="space-y-3">
          <div class="flex items-center gap-2">
            <UInput
              :model-value="data.url"
              readonly
              class="flex-1 font-mono"
            />
            <UButton
              icon="i-lucide-copy"
              aria-label="Copy link"
              @click="copy(data.url)"
            />
          </div>
          <p class="text-xs text-muted">
            <template v-if="activeDomain">
              Your own domain is active, so this is the address to share. The prayer.tools address redirects to it.
            </template>
            <template v-else-if="can('pt.site.manage')">
              You can use your own domain instead on the
              <ULink
                to="/site/settings/domains"
                class="underline"
              >Domains</ULink> page. Once it's active it becomes the main address.
            </template>
            <template v-else>
              When your own domain is active, it becomes the main address and the prayer.tools address redirects to it.
            </template>
          </p>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            QR code
          </h2>
        </template>
        <div class="flex items-center gap-4">
          <img
            :src="data.qrPng"
            alt="QR code for the site link"
            class="size-32 rounded border border-default bg-white"
          >
          <div class="space-y-2">
            <p class="text-sm text-muted">
              For posters, slides and bulletins.
            </p>
            <div class="flex gap-2">
              <UButton
                size="sm"
                variant="outline"
                icon="i-lucide-download"
                label="PNG"
                @click="downloadPng"
              />
              <UButton
                size="sm"
                variant="outline"
                icon="i-lucide-download"
                label="SVG"
                @click="downloadSvg"
              />
            </div>
          </div>
        </div>
      </UCard>
    </div>

    <UCard>
      <template #header>
        <h2 class="font-semibold">
          Share message
        </h2>
      </template>
      <div class="space-y-6">
        <div class="space-y-3">
          <PtTranslatableInput
            v-model="messages"
            :languages="site.site.languages"
            :default-language="site.site.default_language"
            label="Message"
            help="Pre-filled when people share your site from their phone, in their language. The link is added after it."
            multiline
            :source-locked="!can('pt.site.write')"
          />
          <div
            v-if="can('pt.site.write')"
            class="flex justify-end"
          >
            <UButton
              label="Save"
              :loading="saving"
              @click="save"
            />
          </div>
        </div>
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <h3 class="text-sm font-medium">
              WhatsApp preview
            </h3>
            <USelect
              v-if="langItems.length > 1"
              v-model="lang"
              :items="langItems"
              size="sm"
              class="w-44"
            />
          </div>
          <div class="rounded-lg bg-[#e5ddd5] dark:bg-neutral-800 p-4">
            <div
              class="max-w-sm rounded-lg bg-[#dcf8c6] dark:bg-emerald-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 shadow-sm text-sm whitespace-pre-wrap break-words"
              :dir="langDir"
            >
              <div
                v-if="data.shareImageUrl"
                class="mb-2 overflow-hidden rounded"
              >
                <img
                  :src="data.shareImageUrl"
                  alt=""
                  class="w-full h-32 object-cover"
                >
              </div>{{ shareText }}
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton
              :href="whatsapp"
              target="_blank"
              icon="i-simple-icons-whatsapp"
              label="Share on WhatsApp"
              color="success"
            />
            <UButton
              variant="outline"
              color="neutral"
              icon="i-lucide-copy"
              label="Copy message"
              @click="copy(shareText, 'Message')"
            />
          </div>
        </div>
      </div>
    </UCard>

    <UCard v-if="can('pt.site.write')">
      <template #header>
        <h2 class="font-semibold">
          Share image
        </h2>
      </template>
      <p class="text-sm text-muted mb-3">
        Shown in link previews on WhatsApp, Facebook and elsewhere. A wide image (1200 × 630) works best.
      </p>
      <div class="flex flex-wrap items-end gap-4">
        <div
          v-if="data.shareImageUrl"
          class="w-64 aspect-[1200/630] rounded-md overflow-hidden border border-default"
        >
          <img
            :src="data.shareImageUrl"
            alt=""
            class="size-full object-cover"
          >
        </div>
        <div class="flex gap-2">
          <UButton
            size="sm"
            variant="soft"
            icon="i-lucide-image"
            :label="data.shareImageUrl ? 'Change' : 'Choose an image'"
            @click="pickingImage = true"
          />
          <UButton
            v-if="data.shareImageUrl"
            size="sm"
            variant="ghost"
            color="neutral"
            icon="i-lucide-x"
            label="Remove"
            @click="setShareImage(undefined)"
          />
        </div>
      </div>
    </UCard>

    <p class="text-sm text-muted flex items-center gap-2">
      <UIcon
        name="i-lucide-hand-heart"
        class="text-primary"
      />
      Prayer.Tools is free for every site.
      <ULink
        :to="data.donateUrl"
        target="_blank"
        class="text-primary underline"
      >Support Prayer.Tools</ULink>
    </p>

    <PtImagePicker
      v-model:open="pickingImage"
      :language="site.site.default_language"
      @select="(a) => { pickingImage = false; setShareImage(a.url) }"
    />
  </div>
</template>
