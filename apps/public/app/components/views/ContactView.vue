<script setup lang="ts">
import type { SignupFieldView } from '~~/shared/view'

defineProps<{ fields: SignupFieldView[] }>()
const { site, st } = useSite()
const { t } = useI18n()
useHead({ title: () => `${st('landing.contact.title')} · ${site.value.name}` })

const state = reactive({ name: '', email: '', message: '', turnstile: '', answers: {} as Record<string, string | boolean> })
const sending = ref(false)
const done = ref(false)
const error = ref<string | null>(null)

async function submit() {
  sending.value = true
  error.value = null
  try {
    await $fetch('/api/contact', { method: 'POST', body: { ...state, language: site.value.lang } })
    done.value = true
  } catch (err) {
    const msg = (err as { data?: { statusMessage?: string } }).data?.statusMessage ?? 'generic'
    error.value = t(`errors.${msg}`) === `errors.${msg}` ? t('errors.generic') : t(`errors.${msg}`)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-10 space-y-6">
    <h1 class="text-3xl font-bold">{{ st('landing.contact.title') }}</h1>
    <p class="text-stone-700">{{ t('contact.intro', { site: site.name }) }}</p>
    <UAlert v-if="done" color="success" variant="soft" icon="i-lucide-send" :title="t('contact.done')" role="status" />
    <form v-else class="space-y-4" @submit.prevent="submit">
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField :label="t('signup.name')" name="contact-name">
          <UInput v-model="state.name" autocomplete="name" class="w-full" />
        </UFormField>
        <UFormField :label="t('signup.email')" name="contact-email" required>
          <UInput v-model="state.email" type="email" autocomplete="email" required class="w-full" />
        </UFormField>
      </div>
      <UFormField :label="t('contact.message')" name="contact-message" required>
        <UTextarea v-model="state.message" :rows="6" required class="w-full" />
      </UFormField>
      <UFormField v-for="f in fields" :key="f.key" :label="f.kind === 'checkbox' ? undefined : f.label" :name="`field-${f.key}`" :required="f.required">
        <UInput v-if="f.kind === 'text'" v-model="(state.answers[f.key] as string)" :required="f.required" class="w-full" :aria-label="f.label" />
        <USelect v-else-if="f.kind === 'select'" v-model="(state.answers[f.key] as string)" :items="f.options.map(o => ({ label: o.label, value: o.key }))" :placeholder="t('common.choose')" class="w-full" :aria-label="f.label" />
        <UCheckbox v-else v-model="(state.answers[f.key] as boolean)" :label="f.label" :required="f.required" />
      </UFormField>
      <TurnstileWidget v-model="state.turnstile" :site-key="site.turnstileSiteKey" />
      <UAlert v-if="error" color="error" variant="soft" :title="error" role="alert" />
      <UButton type="submit" :loading="sending" :label="t('contact.send')" class="campaign-contact-button" />
    </form>
  </div>
</template>

<style scoped>
.campaign-contact-button {
  background-color: var(--brand);
  color: var(--brand-text);
}
.campaign-contact-button:hover,
.campaign-contact-button:active {
  background-color: var(--brand);
  color: var(--brand-text);
}
</style>
