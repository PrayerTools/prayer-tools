<script setup lang="ts">
const { public: { platformUrl } } = useRuntimeConfig()
</script>

<template>
  <div class="signup-theme min-h-dvh flex flex-col">
    <header class="bg-[#202833] text-white">
      <div class="max-w-7xl mx-auto flex items-center justify-between gap-6 px-6 py-6">
        <a :href="platformUrl" class="relative block h-[38px] w-[120px] shrink-0" aria-label="Prayer.Tools home">
          <img src="/prayer-tools-logo.png" alt="" width="120" height="38" class="logo-symbol absolute inset-0 h-full w-full" />
          <img src="/prayer-tools-logo.png" alt="" width="120" height="38" class="logo-text absolute inset-0 h-full w-full" />
        </a>
        <a :href="platformUrl" class="text-sm font-medium text-white/80 hover:text-white">Back to home</a>
      </div>
    </header>
    <main class="flex flex-1 items-center justify-center px-6 py-12 sm:py-16">
      <div class="w-full max-w-md">
        <slot />
      </div>
    </main>
  </div>
</template>

<style scoped>
.signup-theme {
  --ui-primary: #b84c0b;
  --ui-bg: #ffffff;
  --ui-bg-muted: #fffaf5;
  --ui-bg-elevated: #fffaf5;
  --ui-bg-accented: #f1e7dd;
  --ui-text: #202833;
  --ui-text-highlighted: #202833;
  --ui-text-toned: #44403c;
  --ui-text-muted: #57534e;
  --ui-text-dimmed: #78716c;
  --ui-border: #e8ded5;
  --ui-border-accented: #d6c9bd;
  --ui-border-muted: #eee5dc;
  --ui-radius: 0.75rem;
  background: #fffaf5;
  color: #202833;
}
.signup-theme :deep(form button[type='submit']) {
  background: #c45100;
  color: #ffffff;
  border-radius: 999px;
  font-weight: 600;
}
.signup-theme :deep(form button[type='submit']:hover:not(:disabled)) { background: #a94300; }
.signup-theme :deep(h1) { letter-spacing: -0.035em; }
.logo-symbol { clip-path: inset(0 69% 0 0); }
.logo-text { clip-path: inset(0 0 0 31%); filter: brightness(0) invert(1); }
</style>
