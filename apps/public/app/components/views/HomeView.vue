<script setup lang="ts">
import heroPhotos from '~/utils/hero-photos.json'

defineProps<{ adminUrl: string }>()
const { t } = useI18n()
useHead({ title: () => `Prayer.Tools · ${t('home.title')}` })

const steps = [
  { icon: 'i-lucide-sliders-horizontal', key: 'setup' },
  { icon: 'i-lucide-users', key: 'invite' },
  { icon: 'i-lucide-heart-handshake', key: 'pray' }
] as const

const photoIndex = ref(0)
const currentPhoto = computed(() => heroPhotos[photoIndex.value]!)
let photoTimer: ReturnType<typeof setInterval> | undefined

function nextPhoto() {
  const offset = 1 + Math.floor(Math.random() * (heroPhotos.length - 1))
  photoIndex.value = (photoIndex.value + offset) % heroPhotos.length
}

onMounted(() => {
  photoIndex.value = Math.floor(Math.random() * heroPhotos.length)
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    photoTimer = setInterval(nextPhoto, 12000)
  }
})
onBeforeUnmount(() => clearInterval(photoTimer))
</script>

<template>
  <div class="home-page min-h-dvh flex flex-col bg-[#fffaf5]">
    <header class="home-header text-white">
      <div class="max-w-7xl mx-auto px-6 py-6 flex items-center gap-4 sm:gap-8">
        <a href="/" class="relative me-auto block h-[38px] w-[120px] shrink-0" aria-label="Prayer.Tools home">
          <img src="/prayer-tools-logo.png" alt="" width="120" height="38" class="logo-symbol absolute inset-0 h-full w-full" />
          <img src="/prayer-tools-logo.png" alt="" width="120" height="38" class="logo-text absolute inset-0 h-full w-full" />
        </a>
        <nav class="flex items-center gap-4 sm:gap-8" aria-label="Main">
          <a href="/my" class="text-sm font-medium text-white/80 transition-colors hover:text-white">{{ t('my.title') }}</a>
          <a :href="adminUrl" class="rounded-full border border-white/30 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10">{{ t('home.sign_in') }}</a>
        </nav>
      </div>
    </header>
    <main id="main" class="flex-1">
      <section class="hero-shell text-white" aria-labelledby="home-title">
        <img :src="currentPhoto.src" :alt="currentPhoto.alt" width="1200" height="800" fetchpriority="high" class="hero-image" />
        <div class="hero-overlay" aria-hidden="true" />
        <div class="hero-content relative z-10 max-w-7xl mx-auto flex w-full flex-col justify-center px-6 py-20 sm:py-28">
        <div class="max-w-2xl space-y-8">
        <div class="h-1 w-12 rounded-full bg-[#f58220]" aria-hidden="true" />
        <h1 id="home-title" class="hero-title text-balance">{{ t('home.title') }}</h1>
        <p class="max-w-lg text-lg leading-relaxed text-white/85 text-pretty">{{ t('home.intro') }}</p>
        <div class="flex flex-wrap items-center gap-4 pt-2">
          <UButton :to="`${adminUrl}/orgs/new`" external size="xl" class="hero-cta rounded-full px-6 py-4 font-semibold" :label="t('home.start')" />
          <UButton to="/my" external size="xl" color="neutral" variant="ghost" trailing-icon="i-lucide-arrow-right" class="rounded-full text-white/90 hover:bg-white/10" :label="t('my.title')" />
        </div>
        </div>
        </div>
      </section>
      <section id="how-it-works" class="max-w-7xl mx-auto px-6 py-20 sm:py-24" aria-labelledby="home-how">
        <div class="mb-12 max-w-2xl space-y-4">
          <p class="text-sm font-semibold uppercase tracking-[0.18em] text-[#8a4b28]">{{ t('home.how_label') }}</p>
          <h2 id="home-how" class="text-3xl font-semibold tracking-tight text-[#202833] sm:text-4xl text-balance">{{ t('home.how_title') }}</h2>
          <p class="text-lg leading-relaxed text-stone-600">{{ t('home.how_intro') }}</p>
        </div>
        <ol class="grid gap-6 md:grid-cols-3">
        <li v-for="step in steps" :key="step.key" class="feature-card rounded-3xl bg-white p-7 sm:p-8">
          <div class="mb-7 flex items-center justify-between">
            <span class="flex size-12 items-center justify-center rounded-2xl bg-[#fff0e3]"><UIcon :name="step.icon" class="size-6 text-[#b84c0b]" aria-hidden="true" /></span>
          </div>
          <h3 class="mb-3 text-xl font-semibold tracking-tight">{{ t(`home.step_${step.key}_title`) }}</h3>
          <p class="text-base leading-relaxed text-stone-600">{{ t(`home.step_${step.key}_body`) }}</p>
        </li>
        </ol>
      </section>
    </main>
    <footer class="mx-6 border-t border-[#e8ded5] py-8 text-center text-sm text-stone-500 space-y-4">
      <nav aria-label="Footer" class="flex flex-wrap justify-center gap-x-6 gap-y-3 text-stone-700">
        <a href="/" class="hover:underline underline-offset-4">Home</a>
        <a href="#how-it-works" class="hover:underline underline-offset-4">{{ t('home.how_label') }}</a>
        <a href="/my" class="hover:underline underline-offset-4">{{ t('my.title') }}</a>
        <a :href="adminUrl" class="hover:underline underline-offset-4">{{ t('home.sign_in') }}</a>
      </nav>
      <p>© 2026 Prayer.Tools. Operated by <a href="https://gospelambition.org/" target="_blank" rel="noopener noreferrer" class="underline underline-offset-4 hover:text-stone-800">Gospel Ambition</a>.</p>
      <p class="text-xs">Photos: <a href="https://www.imb.org/photos/browse/?collection=faces-of-the-world&amp;media=image" target="_blank" rel="noopener noreferrer" class="underline underline-offset-4 hover:text-stone-800">IMB</a> · <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noopener noreferrer" class="underline underline-offset-4 hover:text-stone-800">CC BY-NC 4.0</a> · Cropped</p>
    </footer>
  </div>
</template>

<style scoped>
.home-page {
  --brand: #b84c0b;
  --ui-primary: #b84c0b;
}

.home-header { background: #202833; }
.hero-shell { position: relative; isolation: isolate; overflow: hidden; background: #202833; }
.hero-content { min-height: min(760px, 85svh); }
.hero-overlay { position: absolute; inset: 0; background: linear-gradient(90deg, rgb(13 22 32 / 92%) 0%, rgb(13 22 32 / 78%) 35%, rgb(13 22 32 / 32%) 75%, rgb(13 22 32 / 18%) 100%); }
.hero-title { font-size: clamp(2.6rem, 4.5vw, 4.25rem); line-height: 1.06; letter-spacing: -0.045em; font-weight: 650; }
.hero-cta { background: #c45100; color: #ffffff; transition: background 180ms ease; }
.hero-cta:hover { background: #a94300; }
.hero-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center 40%; }
.feature-card { border: 1px solid #eee5dc; box-shadow: 0 8px 30px #50321a05; }
@media (max-width: 639px) {
  .hero-content { min-height: 680px; }
  .hero-overlay { background: linear-gradient(90deg, rgb(13 22 32 / 86%), rgb(13 22 32 / 62%)); }
}

.logo-symbol {
  clip-path: inset(0 69% 0 0);
}

.logo-text {
  clip-path: inset(0 0 0 31%);
  filter: brightness(0) invert(1);
}
</style>
