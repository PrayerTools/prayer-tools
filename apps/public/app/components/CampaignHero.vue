<script setup lang="ts">
// The band at the top of a campaign's landing and ended pages: the hero image
// behind the brand color (or untinted), and the photo credit. pt-15 leaves room
// for the site header, which overlays it.
defineProps<{ titleId: string }>()
const { site } = useSite()
const { t } = useI18n()

const imageStyle = computed(() => site.value.image ? { objectPosition: `${site.value.image.fx * 100}% ${site.value.image.fy * 100}%` } : {})

// Splits the image credit so web addresses in it render as links.
const creditParts = computed(() => (site.value.image?.credit ?? '')
  .split(/(https?:\/\/[^\s<>"]*[^\s<>".,;:!?)])/)
  .filter(Boolean)
  .map(text => ({ text, url: /^https?:\/\//.test(text) })))
</script>

<template>
  <!-- An untinted image keeps the text white, with a shadow for contrast. -->
  <section class="brand-bg relative overflow-clip pt-15" :class="site.image && !site.image.tint && 'pt-untinted'" :aria-labelledby="titleId" data-pt-section="top">
    <template v-if="site.image">
      <img :src="site.image.url" :alt="site.image.alt" class="pt-parallax absolute inset-0 size-full object-cover" :style="imageStyle" fetchpriority="high">
      <!-- Tints the image with the brand color so text keeps its contrast. -->
      <div v-if="site.image.tint" class="absolute inset-0 bg-(--brand) opacity-80" aria-hidden="true" />
    </template>
    <div class="relative max-w-3xl mx-auto px-4 py-16 sm:py-28 text-center">
      <slot />
    </div>
    <UPopover v-if="site.image?.credit" :content="{ side: 'top', align: 'end' }">
      <UButton icon="i-lucide-info" size="sm" variant="ghost" color="neutral" class="absolute bottom-1 end-1 rounded-full text-(--brand-text) opacity-80 hover:opacity-100 hover:bg-white/10" :aria-label="t('landing.photo_credit')" />
      <template #content>
        <div class="max-w-xs p-3 text-xs space-y-1">
          <p class="font-medium">{{ t('landing.photo_credit') }}</p>
          <p>
            <template v-for="(part, i) in creditParts" :key="i">
              <a v-if="part.url" :href="part.text" target="_blank" rel="noopener noreferrer nofollow" class="underline underline-offset-2 break-all">{{ part.text }}</a>
              <template v-else>{{ part.text }}</template>
            </template>
          </p>
        </div>
      </template>
    </UPopover>
  </section>
</template>
