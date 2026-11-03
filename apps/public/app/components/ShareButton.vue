<script setup lang="ts">
// Web Share API with a WhatsApp fallback. The link carries the sharer's
// referral code when this browser knows it.
// `iconOnly` is the compact header form: the share icon alone, without copy.
const props = withDefaults(defineProps<{ label?: string, size?: 'sm' | 'md' | 'lg' | 'xl', variant?: 'solid' | 'outline' | 'soft', iconOnly?: boolean }>(), { size: 'lg', variant: 'solid' })
const { site, shareUrl, shareText } = useSite()
const { t } = useI18n()
const copied = ref(false)
const referral = useReferral()

const url = computed(() => shareUrl(referral.value))
const whatsapp = computed(() => `https://wa.me/?text=${encodeURIComponent(`${shareText()} ${url.value}`)}`)

async function share() {
  const data = { title: site.value.name, text: shareText(), url: url.value }
  if (navigator.share) {
    try {
      await navigator.share(data)
      trackEvent('campaign_shared', { channel: 'native', campaign_id: site.value.campaign?.id })
    } catch {
      // cancelled
    }
    return
  }
  window.open(whatsapp.value, '_blank', 'noopener')
  trackEvent('campaign_shared', { channel: 'whatsapp', campaign_id: site.value.campaign?.id })
}

async function copy() {
  try {
    await navigator.clipboard.writeText(url.value)
    copied.value = true
    trackEvent('campaign_shared', { channel: 'copy', campaign_id: site.value.campaign?.id })
    setTimeout(() => (copied.value = false), 2500)
  } catch {
    // clipboard unavailable
  }
}
</script>

<template>
  <UButton v-if="props.iconOnly" color="neutral" variant="ghost" icon="i-lucide-share-2" :aria-label="props.label ?? t('share.button')" :title="props.label ?? t('share.button')" class="text-(--brand-text) hover:bg-white/10" @click="share" />
  <div v-else class="flex flex-wrap items-center gap-2">
    <UButton :size="props.size" :variant="props.variant" icon="i-lucide-share-2" :label="props.label ?? t('share.button')" @click="share" />
    <UButton :size="props.size" variant="ghost" color="neutral" :icon="copied ? 'i-lucide-check' : 'i-lucide-link'" :label="copied ? t('share.copied') : t('share.copy')" @click="copy" />
  </div>
</template>
