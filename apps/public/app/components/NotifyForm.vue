<script setup lang="ts">
// "Notify me when this campaign runs again" for the campaign shown: grants the
// site-updates consent and emails a link to confirm the request. Signed in to
// Prayer.Tools on this site, the account's address asks with one button,
// confirmed at once.
const { site } = useSite()
const { t } = useI18n()
const email = ref('')
const name = ref('')
const token = ref('')
const done = ref<'sent' | 'confirmed' | 'already' | null>(null)
const error = ref<string | null>(null)
const sending = ref(false)
const account = ref<{ email: string, name: string | null } | null>(null)
const useAccount = ref(false)

const doneTitle = computed(() => done.value === 'already'
  ? t('between.notify_already')
  : done.value === 'confirmed' ? t('notice.notify_confirmed') : t('between.notify_done'))

onMounted(async () => {
  const me = await fetchMe()
  if (me?.account) {
    account.value = me.account
    useAccount.value = true
    if (!name.value && me.account.name) name.value = me.account.name
  }
})

async function submit() {
  sending.value = true
  error.value = null
  const asAccount = useAccount.value && !!account.value
  try {
    const body = asAccount
      ? { account: true, campaign: site.value.campaign?.id, language: site.value.lang, turnstile: token.value }
      : { email: email.value, name: name.value, campaign: site.value.campaign?.id, language: site.value.lang, turnstile: token.value }
    const res = await $fetch<{ ok: true, already?: boolean }>('/api/notify', { method: 'POST', body })
    done.value = asAccount ? (res.already ? 'already' : 'confirmed') : 'sent'
  } catch (err) {
    // A sign-in that ended since the page loaded falls back to the form.
    if (asAccount && (err as { data?: { statusMessage?: string } }).data?.statusMessage === 'account') useAccount.value = false
    error.value = t('errors.generic')
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <UAlert v-if="done" color="success" variant="soft" icon="i-lucide-bell" :title="doneTitle" role="status" />
  <form v-else class="space-y-4" @submit.prevent="submit">
    <div v-if="useAccount && account" class="space-y-2">
      <UAlert
        color="success"
        variant="soft"
        icon="i-lucide-badge-check"
        :title="account.name ? t('between.notify_as_named', { name: account.name, email: account.email }) : t('between.notify_as', { email: account.email })"
      />
      <UButton variant="link" color="neutral" size="sm" class="px-0" :label="t('signup.use_other_email')" @click="useAccount = false" />
    </div>
    <div v-else class="grid gap-4 sm:grid-cols-2">
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
