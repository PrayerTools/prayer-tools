<script setup lang="ts">
import ThemeToggle from './ThemeToggle.vue'
</script>

<template>
  <header class="home-header bg-[#202833] text-white">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex items-center gap-3 sm:gap-6">
      <a href="/" class="relative block h-[38px] w-[120px] shrink-0 me-auto" aria-label="Prayer.Tools home">
        <img src="/prayer-tools-logo.png" alt="" width="120" height="38" class="absolute inset-0 h-full w-full [clip-path:inset(0_69%_0_0)]" />
        <img src="/prayer-tools-logo.png" alt="" width="120" height="38" class="absolute inset-0 h-full w-full [clip-path:inset(0_0_0_31%)] brightness-0 invert" />
      </a>
      <ThemeToggle />
      <slot />
    </div>
  </header>
</template>
