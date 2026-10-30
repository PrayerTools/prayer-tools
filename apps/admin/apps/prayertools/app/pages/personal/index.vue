<script setup lang="ts">
// The champion's personal library: images and reusable blocks, usable on
// any of their sites. Email templates live under Site email → Templates.
definePageMeta({ middleware: 'auth', tenantExempt: true })

interface Asset { id: string, url: string, url_small: string | null, alt: { source: string, values: Record<string, string> } | null, credit: string | null, focal_x: number, focal_y: number, width: number | null, height: number | null }
interface Block { id: string, name: string, content: Record<string, any>, updated_at: string }

const toast = usePtToast()
const { data: assets, refresh: refreshAssets } = useFetch<{ assets: Asset[] }>('/api/pt/assets', { key: 'pt-assets' })
const { data: blocks, refresh: refreshBlocks } = useFetch<{ blocks: Block[] }>('/api/pt/blocks', { key: 'pt-blocks' })
const uploadOpen = ref(false)
const editing = ref<Asset | null>(null)

async function saveAsset() {
  const a = editing.value
  if (!a) return
  try {
    await $fetch(`/api/pt/assets/${a.id}`, { method: 'PATCH', body: { alt: a.alt, credit: a.credit, focal_x: a.focal_x, focal_y: a.focal_y } })
    editing.value = null
    await refreshAssets()
  } catch (err) {
    toast.fail(err)
  }
}
async function deleteAsset(a: Asset) {
  await $fetch(`/api/pt/assets/${a.id}`, { method: 'DELETE' })
  editing.value = null
  await refreshAssets()
}

const block = reactive({ open: false, id: null as string | null, name: '', content: null as Record<string, any> | null })
function editBlock(b?: Block) {
  Object.assign(block, { open: true, id: b?.id ?? null, name: b?.name ?? '', content: b?.content ?? null })
}
async function saveBlock() {
  try {
    if (block.id) await $fetch(`/api/pt/blocks/${block.id}`, { method: 'PATCH', body: { name: block.name, content: block.content } })
    else await $fetch('/api/pt/blocks', { method: 'POST', body: { name: block.name, content: block.content } })
    block.open = false
    await refreshBlocks()
  } catch (err) {
    toast.fail(err)
  }
}
async function deleteBlock(id: string) {
  await $fetch(`/api/pt/blocks/${id}`, { method: 'DELETE' })
  await refreshBlocks()
}
</script>

<template>
  <div class="max-w-6xl mx-auto space-y-8">
    <PtLibraryTabs />
    <div class="rounded-lg bg-[#202833] p-6 sm:p-8 text-white">
      <p class="mb-3 text-xs font-semibold uppercase tracking-widest text-orange-300">Your reusable library</p>
      <h1 class="text-2xl font-semibold">
        My images and blocks
      </h1>
      <p class="mt-3 max-w-2xl text-sm leading-relaxed text-slate-200">
        Yours to reuse on any of your sites. Using one on a site makes a copy there.
      </p>
    </div>

    <section class="space-y-5 rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) p-5 sm:p-6">
      <div class="flex flex-wrap gap-3 items-center justify-between">
        <div><h2 class="text-lg font-semibold">
          Images
        </h2><p class="mt-1 text-sm text-(--ui-text-muted)">Photos and artwork ready to use across your sites.</p></div>
        <UButton
          icon="i-lucide-upload"
          label="Add images"
          size="lg"
          @click="uploadOpen = true"
        />
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <button
          v-for="a in assets?.assets ?? []"
          :key="a.id"
          type="button"
          class="aspect-square rounded-lg overflow-hidden border border-(--ui-border) cursor-pointer hover:ring-2 hover:ring-(--ui-primary)/40 focus-visible:ring-2 focus-visible:ring-(--ui-primary)"
          :aria-label="`Edit ${a.alt?.values[a.alt.source] ?? 'image'}`"
          @click="editing = JSON.parse(JSON.stringify(a))"
        >
          <img
            :src="a.url_small || a.url"
            :alt="a.alt?.values[a.alt.source] ?? ''"
            class="size-full object-cover"
            :style="{ objectPosition: `${a.focal_x * 100}% ${a.focal_y * 100}%` }"
          >
        </button>
      </div>
      <UEmpty
        v-if="!assets?.assets.length"
        icon="i-lucide-image"
        title="No images yet"
        description="Add your first image to build a library you can reuse on any site."
      />
    </section>

    <section class="space-y-5 rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) p-5 sm:p-6">
      <div class="flex flex-wrap gap-3 items-center justify-between">
        <div><h2 class="text-lg font-semibold">
          Reusable blocks
        </h2><p class="mt-1 text-sm text-(--ui-text-muted)">Save frequently used prayer text and other content for next time.</p></div>
        <UButton
          icon="i-lucide-plus"
          label="New block"
          size="lg"
          @click="editBlock()"
        />
      </div>
      <UEmpty v-if="!blocks?.blocks.length" icon="i-lucide-blocks" title="No blocks yet" description="Create a block for content you want to use again across your sites." />
      <UCard
        v-for="b in blocks?.blocks ?? []"
        :key="b.id"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="font-medium">
              {{ b.name }}
            </p>
            <PtContentView
              :doc="b.content"
              class="text-sm line-clamp-3"
            />
          </div>
          <div class="flex gap-1">
            <UButton
              size="xs"
              variant="ghost"
              label="Edit"
              @click="editBlock(b)"
            />
            <UButton
              size="xs"
              variant="ghost"
              color="error"
              label="Delete"
              @click="deleteBlock(b.id)"
            />
          </div>
        </div>
      </UCard>
    </section>

    <PtImagePicker
      v-model:open="uploadOpen"
      @select="() => { uploadOpen = false; refreshAssets() }"
    />

    <UModal
      :open="!!editing"
      title="Image"
      @update:open="(v) => { if (!v) editing = null }"
    >
      <template #body>
        <div
          v-if="editing"
          class="space-y-3"
        >
          <div class="relative">
            <img
              :src="editing.url"
              alt=""
              class="w-full rounded-md"
            >
            <span
              class="absolute size-4 rounded-full border-2 border-white bg-(--ui-primary) -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              :style="{ left: `${editing.focal_x * 100}%`, top: `${editing.focal_y * 100}%` }"
            />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Focal point (across)">
              <USlider
                v-model="editing.focal_x"
                :min="0"
                :max="1"
                :step="0.05"
              />
            </UFormField>
            <UFormField label="Focal point (down)">
              <USlider
                v-model="editing.focal_y"
                :min="0"
                :max="1"
                :step="0.05"
              />
            </UFormField>
          </div>
          <PtTranslatableInput
            v-model="editing.alt"
            :languages="Object.keys(editing.alt?.values ?? { en: '' })"
            :default-language="editing.alt?.source ?? 'en'"
            label="Description (alt text)"
          />
          <UFormField label="Credit">
            <UInput
              v-model="editing.credit"
              class="w-full"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-between w-full">
          <UButton
            color="error"
            variant="ghost"
            label="Delete"
            @click="editing && deleteAsset(editing)"
          />
          <UButton
            label="Save"
            @click="saveAsset"
          />
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="block.open"
      :title="block.id ? 'Edit block' : 'New block'"
      :ui="{ content: 'max-w-3xl' }"
    >
      <template #body>
        <div class="space-y-3">
          <UFormField label="Name">
            <UInput
              v-model="block.name"
              class="w-full"
            />
          </UFormField>
          <PtRichEditor
            v-model="block.content"
            placeholders
          />
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end w-full">
          <UButton
            label="Save"
            :disabled="!block.name.trim()"
            @click="saveBlock"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
