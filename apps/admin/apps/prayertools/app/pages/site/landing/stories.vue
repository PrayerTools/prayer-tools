<script setup lang="ts">
// Stories people submitted. Each also arrived in the inbox as a thread; here
// the team chooses which (allowed) stories appear on the landing page.
definePageMeta({ middleware: 'auth' })

interface Story { id: string, name: string | null, body: string, language: string, may_publish: boolean, may_platform: boolean, use_name: boolean, published: boolean, created_at: string, conversation_id: string | null }

const { data: site, can } = usePtSite()
const { data: meta } = usePtMeta()
const { campaign } = usePtCampaign()
const toast = usePtToast()
const { data, refresh } = useFetch<{ stories: Story[] }>('/api/pt/stories', { key: 'pt-stories' })

const publishableOnly = ref(false)
const shown = computed(() => (data.value?.stories ?? []).filter(s => !publishableOnly.value || s.may_publish))
const inboxUrl = computed(() => site.value && can('inbox.access') ? `/@${site.value.org.slug}/inbox` : null)
const storiesSectionOff = computed(() => {
  const c = campaign.value
  const l = c?.landing
  if (!c || !l) return false
  const hidden: string[] = l.hidden ?? meta.value?.templates.find(t => t.key === c.template_key)?.hiddenSections ?? []
  return l.stories === false || hidden.includes('stories')
})

const busy = ref<string | null>(null)
async function setPublished(s: Story, published: boolean) {
  busy.value = s.id
  try {
    await $fetch(`/api/pt/stories/${s.id}`, { method: 'PATCH', body: { published } })
    await refresh()
    toast.ok(published ? 'Added to your landing page' : 'Removed from your landing page')
  } catch (err) {
    toast.fail(err)
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6">
    <PtLandingTabs />
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div class="flex flex-wrap items-center gap-3">
          <h1 class="text-2xl font-semibold">
            Stories
          </h1>
          <UBadge
            color="neutral"
            variant="outline"
            icon="i-lucide-layers"
            label="Shared by all campaigns"
          />
        </div>
        <p class="text-sm text-(--ui-text-muted) max-w-xl">
          Prayer stories sent from your site, with what each writer allowed. Read and answer them in the inbox; add the ones you may publish to your landing page.
        </p>
      </div>
      <UButton
        v-if="inboxUrl"
        :to="inboxUrl"
        variant="outline"
        color="neutral"
        icon="i-lucide-inbox"
        label="Open the inbox"
      />
    </header>

    <UAlert
      v-if="storiesSectionOff && can('pt.site.write')"
      color="warning"
      variant="subtle"
      icon="i-lucide-eye-off"
      title="The stories section is turned off on your landing page."
      description="Stories you add here show once you turn it on."
      :actions="[{ label: 'Landing page', to: `/@${site?.org.slug}/site/landing`, variant: 'soft', color: 'warning' }]"
    />

    <USwitch
      v-model="publishableOnly"
      label="Only stories I may publish"
    />

    <UCard v-if="!shown.length">
      <p class="text-sm text-(--ui-text-muted)">
        {{ publishableOnly ? 'No stories you may publish yet.' : 'No stories yet.' }}
      </p>
    </UCard>
    <UCard
      v-for="s in shown"
      :key="s.id"
    >
      <div class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span class="font-medium">{{ s.name || 'No name given' }}</span>
          <span class="text-(--ui-text-muted)">{{ ptFormatDate(s.created_at, { dateStyle: 'medium', timeStyle: 'short' }) }}<span v-if="s.language"> · {{ languageName(meta, s.language) }}</span></span>
        </div>
        <p class="whitespace-pre-line">
          {{ s.body }}
        </p>
        <div class="flex flex-wrap gap-2">
          <UBadge
            :color="s.may_publish ? 'success' : 'neutral'"
            variant="subtle"
            size="sm"
            :icon="s.may_publish ? 'i-lucide-check' : 'i-lucide-x'"
            :label="s.may_publish ? 'You may publish it' : 'Not for publishing'"
          />
          <UBadge
            :color="s.may_platform ? 'success' : 'neutral'"
            variant="subtle"
            size="sm"
            :icon="s.may_platform ? 'i-lucide-check' : 'i-lucide-x'"
            :label="s.may_platform ? 'Prayer.Tools may use it' : 'Not for Prayer.Tools'"
          />
          <UBadge
            v-if="s.may_publish || s.may_platform"
            color="neutral"
            variant="subtle"
            size="sm"
            icon="i-lucide-user"
            :label="s.use_name ? 'Show their name' : 'Keep anonymous'"
          />
          <UBadge
            v-if="s.published"
            color="primary"
            variant="subtle"
            size="sm"
            icon="i-lucide-layout-template"
            label="On your landing page"
          />
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <template v-if="s.may_publish && can('pt.site.write')">
            <UButton
              v-if="!s.published"
              size="sm"
              icon="i-lucide-plus"
              label="Add to landing page"
              :loading="busy === s.id"
              @click="setPublished(s, true)"
            />
            <UButton
              v-else
              size="sm"
              variant="soft"
              color="neutral"
              icon="i-lucide-minus"
              label="Remove from landing page"
              :loading="busy === s.id"
              @click="setPublished(s, false)"
            />
          </template>
          <UButton
            v-if="s.conversation_id && can('inbox.access')"
            size="sm"
            variant="ghost"
            color="neutral"
            icon="i-lucide-message-circle"
            :to="`/@${site?.org.slug}/inbox/${s.conversation_id}`"
            label="Open in inbox"
          />
        </div>
        <p
          v-if="s.may_publish && !s.use_name"
          class="text-xs text-(--ui-text-muted)"
        >
          Shown without a name on your landing page.
        </p>
      </div>
    </UCard>
  </div>
</template>
