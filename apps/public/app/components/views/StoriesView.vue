<script setup lang="ts">
const { site, st } = useSite()
const { t } = useI18n()
useHead({ title: () => `${st('landing.stories.title')} · ${site.value.name}` })

const state = reactive({ story: '', name: '', email: '', mayPublish: false, mayPlatform: false, useName: 'anonymous', turnstile: '' })
const sending = ref(false)
const done = ref(false)
const error = ref<string | null>(null)

onMounted(async () => {
  const me = await fetchMe()
  if (me?.email && !state.email) state.email = me.email
  if (me?.name && !state.name) state.name = me.name
})

const nameChoices = computed(() => [
  { label: t('stories.keep_anonymous'), value: 'anonymous' },
  { label: t('stories.use_name'), value: 'name' }
])

async function submit() {
  sending.value = true
  error.value = null
  try {
    await $fetch('/api/story', {
      method: 'POST',
      body: {
        story: state.story,
        name: state.name,
        email: state.email,
        may_publish: state.mayPublish,
        may_platform: state.mayPlatform,
        use_name: (state.mayPublish || state.mayPlatform) && state.useName === 'name',
        language: site.value.lang,
        campaign: site.value.campaign?.id,
        turnstile: state.turnstile
      }
    })
    done.value = true
  } catch {
    error.value = t('errors.generic')
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-10 space-y-6">
    <h1 class="text-3xl font-bold">{{ t('stories.title') }}</h1>
    <p class="text-stone-700">{{ t('stories.intro', { site: site.name }) }}</p>
    <UAlert v-if="done" color="success" variant="soft" icon="i-lucide-heart" :title="t('stories.done')" role="status" />
    <form v-else class="space-y-5" @submit.prevent="submit">
      <UFormField :label="t('stories.story')" name="story" required>
        <UTextarea v-model="state.story" :rows="8" required class="w-full" />
      </UFormField>
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField :label="t('signup.name')" :hint="t('common.optional')" name="story-name">
          <UInput v-model="state.name" autocomplete="name" class="w-full" />
        </UFormField>
        <UFormField :label="t('signup.email')" name="story-email" required>
          <UInput v-model="state.email" type="email" autocomplete="email" required class="w-full" />
        </UFormField>
      </div>
      <fieldset class="space-y-3">
        <legend class="font-semibold">{{ t('stories.permissions') }}</legend>
        <UCheckbox v-model="state.mayPublish" :label="t('stories.may_publish')" />
        <UCheckbox v-model="state.mayPlatform" :label="t('stories.may_platform')" />
        <URadioGroup v-if="state.mayPublish || state.mayPlatform" v-model="state.useName" :items="nameChoices" :legend="t('stories.name_choice')" />
      </fieldset>
      <TurnstileWidget v-model="state.turnstile" :site-key="site.turnstileSiteKey" />
      <UAlert v-if="error" color="error" variant="soft" :title="error" role="alert" />
      <UButton type="submit" :loading="sending" :label="t('stories.send')" />
    </form>
  </div>
</template>
