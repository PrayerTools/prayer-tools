<script setup lang="ts">
// Libraries: your own (usable on all your sites, private until shared) and
// the catalog of published ones.
definePageMeta({ middleware: 'auth', tenantExempt: true })

interface Library { id: string, title: string, description: string | null, cadence: string, entry_count: number, languages: string[], visibility: string, share_status: string | null, published_version: number, updated_at: string, platform: boolean }

const { data: meta } = usePtMeta()
const toast = usePtToast()
const { data: mine, refresh } = useFetch<{ libraries: Library[] }>('/api/pt/libraries', { query: { scope: 'mine' }, key: 'pt-my-libraries' })

const createOpen = ref(false)
const form = reactive({ title: '', description: '', cadence: 'daily', source_language: 'en', license: 'own', credit: '' })
async function create() {
  try {
    const res = await $fetch<{ id: string }>('/api/pt/libraries', { method: 'POST', body: form })
    createOpen.value = false
    await navigateTo(`/libraries/${res.id}`)
  } catch (err) {
    toast.fail(err)
  }
}
</script>

<template>
  <div class="max-w-6xl mx-auto space-y-8">
    <PtContentTabs />
    <div class="max-w-5xl space-y-8">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl font-semibold">
            Libraries
          </h1>
          <p class="text-sm text-(--ui-text-muted)">
            Reusable prayer content. Your libraries can be used on any of your sites.
          </p>
        </div>
        <UButton
          icon="i-lucide-plus"
          label="New library"
          @click="createOpen = true"
        />
      </div>

      <section class="space-y-3">
        <h2 class="font-semibold">
          Your libraries
        </h2>
        <p
          v-if="!mine?.libraries.length"
          class="text-sm text-(--ui-text-muted)"
        >
          You haven't made a library yet.
        </p>
        <div class="grid sm:grid-cols-2 gap-3">
          <NuxtLink
            v-for="l in mine?.libraries ?? []"
            :key="l.id"
            :to="`/libraries/${l.id}`"
            class="block rounded-lg border border-(--ui-border) p-4 hover:bg-(--ui-bg-elevated)"
          >
            <div class="flex items-start justify-between gap-2">
              <p class="font-medium">
                {{ l.title }}
              </p>
              <UBadge
                :label="l.visibility === 'published' ? 'Shared with everyone' : l.share_status === 'requested' ? 'Share requested' : 'Private'"
                :color="l.visibility === 'published' ? 'success' : 'neutral'"
                variant="soft"
                size="sm"
              />
            </div>
            <p class="text-xs text-(--ui-text-muted)">
              {{ l.entry_count }} {{ l.cadence === 'weekly' ? 'weeks' : 'days' }} · {{ l.languages.map(x => languageName(meta, x)).join(', ') || 'no entries yet' }} · version {{ l.published_version }}
            </p>
          </NuxtLink>
        </div>
      </section>

      <section class="space-y-3">
        <h2 class="font-semibold">
          Catalog
        </h2>
        <PtLibraryCatalog @use="(id) => navigateTo(`/libraries/${id}`)" />
      </section>

      <UModal
        v-model:open="createOpen"
        title="New library"
      >
        <template #body>
          <div class="space-y-3">
            <UFormField
              label="Title"
              required
            >
              <UInput
                v-model="form.title"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Description">
              <UTextarea
                v-model="form.description"
                class="w-full"
              />
            </UFormField>
            <div class="grid grid-cols-2 gap-3">
              <UFormField label="Cadence">
                <USelect
                  v-model="form.cadence"
                  :items="[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }]"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Written in">
                <USelectMenu
                  v-model="form.source_language"
                  :items="(meta?.languages ?? []).map(l => ({ value: l.code, label: l.name }))"
                  value-key="value"
                  class="w-full"
                />
              </UFormField>
            </div>
            <UFormField label="License">
              <USelect
                v-model="form.license"
                :items="(meta?.licenses ?? []).map(l => ({ value: l, label: PT_LABELS.license[l] }))"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Credit line"
              help="Shown under the content on sites, e.g. “Content by …”."
            >
              <UInput
                v-model="form.credit"
                class="w-full"
              />
            </UFormField>
          </div>
        </template>
        <template #footer>
          <div class="flex justify-end w-full">
            <UButton
              label="Create"
              :disabled="form.title.trim().length < 2"
              @click="create"
            />
          </div>
        </template>
      </UModal>
    </div>
  </div>
</template>
