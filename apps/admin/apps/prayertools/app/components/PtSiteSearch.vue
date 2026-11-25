<script setup lang="ts">
// The search box in the top bar while a site is open; ⌘K / Ctrl+K opens it
// too. Core's top bars have no slot for it, so its buttons are teleported to
// the start of their right-hand group.
const { user } = useAuth()
const route = useRoute()
const inSite = computed(() => !!user.value && !!route.params.orgSlug)
const open = ref(false)

defineShortcuts({
  meta_k: () => {
    if (inSite.value) open.value = !open.value
  }
})
watch(() => route.fullPath, () => {
  open.value = false
})

const targets = shallowRef<{ desktop: Element | null, mobile: Element | null }>({ desktop: null, mobile: null })
function findTargets() {
  targets.value = {
    desktop: document.querySelector('header.lg\\:flex > div:last-child'),
    mobile: document.querySelector('header.lg\\:hidden > div:last-child')
  }
}
onMounted(findTargets)
watch(user, () => nextTick(findTargets))
</script>

<template>
  <template v-if="inSite">
    <Teleport
      v-if="targets.desktop"
      :to="targets.desktop"
    >
      <UButton
        icon="i-lucide-search"
        label="Search…"
        color="neutral"
        variant="outline"
        class="-order-1 w-56 lg:w-64"
        :ui="{ label: 'flex-1 text-left text-(--ui-text-muted)' }"
        @click="open = true"
      >
        <template #trailing>
          <span class="flex gap-0.5">
            <UKbd value="meta" />
            <UKbd value="k" />
          </span>
        </template>
      </UButton>
    </Teleport>
    <Teleport
      v-if="targets.mobile"
      :to="targets.mobile"
    >
      <UButton
        icon="i-lucide-search"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="Search"
        class="-order-1"
        @click="open = true"
      />
    </Teleport>
    <UModal
      v-model:open="open"
      title="Search"
      description="Find a page or setting of this site."
      :ui="{ content: 'sm:max-w-2xl' }"
    >
      <template #content>
        <PtSiteSearchPalette @close="open = false" />
      </template>
    </UModal>
  </template>
</template>
