<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

// The header's account button: "Sign in" for a visitor, or the signed-in
// person's avatar (their first letter without one) opening the account menu.
// Nothing shows until `ready`, so "Sign in" never flips to the avatar.
const props = withDefaults(defineProps<{
  account: { name: string | null, email: string | null, avatar: string | null } | null
  ready: boolean
  signInHref: string | null
  items: DropdownMenuItem[][]
  buttonClass?: string
}>(), { buttonClass: 'text-(--brand-text) hover:bg-white/10' })
const { t } = useI18n()

const label = computed(() => props.account?.name || props.account?.email || '')
const initial = computed(() => label.value.trim().charAt(0).toUpperCase())
</script>

<template>
  <template v-if="ready">
    <UDropdownMenu v-if="account" :items="items" :content="{ align: 'end' }">
      <UButton color="neutral" variant="ghost" square class="rounded-full p-0.5" :class="buttonClass" :aria-label="t('account.menu')">
        <UAvatar :src="account.avatar || undefined" :alt="label" :text="initial" size="md" />
      </UButton>
      <template #content-top>
        <div class="px-2.5 py-2 text-sm">
          <p v-if="account.name" class="font-medium truncate">{{ account.name }}</p>
          <p v-if="account.email" class="text-stone-600 truncate">{{ account.email }}</p>
        </div>
      </template>
    </UDropdownMenu>
    <UButton v-else-if="signInHref" :to="signInHref" external color="neutral" variant="ghost" icon="i-lucide-log-in" :class="buttonClass" :label="t('signup.sign_in')" :aria-label="t('signup.sign_in')" :ui="{ label: 'hidden sm:inline' }" />
  </template>
</template>
