<script setup lang="ts">
// "Notify me when this campaign runs again": grants the site-updates consent
// and emails a link to confirm the request for the campaign shown.
const { site } = useSite()
const { t } = useI18n()
const email = ref('')
const name = ref('')
const token = ref('')
const done = ref(false)
const error = ref<string | null>(null)
const sending = ref(false)

async function submit() {
  sending.value = true
  error.value = null
  try {
    await $fetch('/api/notify', { method: 'POST', body: { email: email.value, name: name.value, campaign: site.value.campaign?.id, language: site.value.lang, turnstile: token.value } })
    done.value = true
  } catch {
    error.value = t('errors.generic')
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <UAlert v-if="done" color="success" variant="soft" icon="i-lucide-bell" :title="t('between.notify_done')" role="status" />
  <form v-else class="space-y-4" @submit.prevent="submit">
    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField :label="t('signup.email')" name="notify-email" required>
        <UInput v-model="email" type="email" autocomplete="email" required class="w-full" />
      </UFormField>
      <UFormField :label="t('signup.name')" :hint="t('common.optional')" name="notify-name">
        <UInput v-model="name" autocomplete="given-name" class="w-full" />
      </UFormField>
    </div>
    <TurnstileWidget v-model="token" :site-key="site.turnstileSiteKey" />
    <UAlert v-if="error" color="error" variant="soft" :title="error" role="alert" />
    <UButton type="submit" :loading="sending" icon="i-lucide-bell" :label="t('between.notify_button')" />
  </form>
</template>
