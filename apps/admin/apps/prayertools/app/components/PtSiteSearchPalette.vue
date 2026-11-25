<script setup lang="ts">
// The search box's results for the current site: its pages and tabs, its
// campaigns, and every setting (the chosen campaign's own on its page).
// Campaigns and settings show once something is typed.
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui'
import type { PtSearchEntry } from '../utils/pt-site-search'

const emit = defineEmits<{ close: [] }>()
const { can, isOwner, slug } = usePtSite()
const { id: campaignId, campaign, campaigns } = usePtCampaign()

function go(to: string, query?: Record<string, string>) {
  emit('close')
  navigateTo({ path: `/@${slug.value}${to}`, query })
}

function allowed(e: PtSearchEntry) {
  if (e.perm && !can(e.perm)) return false
  if (e.ownerOnly && !isOwner.value) return false
  return !e.campaign || !!campaignId.value
}

function toItem(e: PtSearchEntry): CommandPaletteItem {
  const to = e.campaign ? e.to.replace(':id', campaignId.value!) : e.to
  return {
    label: e.label,
    description: e.campaign ? `${e.where} › ${campaign.value?.name}` : e.where,
    icon: e.icon,
    keywords: e.keywords ?? '',
    onSelect: () => go(to, e.query)
  }
}

const onlyWhenTyped = (term: string, items: CommandPaletteItem[]) => term ? items : []

const groups = computed<CommandPaletteGroup[]>(() => [
  { id: 'pages', label: 'Pages', items: PT_SEARCH_PAGES.filter(allowed).map(toItem) },
  {
    id: 'campaigns',
    label: 'Campaigns',
    items: campaigns.value.map(c => ({ label: c.name, description: ptCampaignDates(c), icon: 'i-lucide-calendar-range', onSelect: () => go(`/site/campaigns/${c.id}`) })),
    postFilter: onlyWhenTyped
  },
  { id: 'settings', label: 'Settings', items: ptSearchSettings().filter(allowed).map(toItem), postFilter: onlyWhenTyped }
])

const fuse = { fuseOptions: { threshold: 0.2, keys: ['keywords'] } }
</script>

<template>
  <UCommandPalette
    :groups="groups"
    :fuse="fuse"
    placeholder="Search pages and settings…"
    close
    class="h-[28rem] max-h-[80vh]"
    @update:open="(v: boolean) => !v && emit('close')"
  >
    <!-- Keyed by icon: rows are reused as results change, and Nuxt Icon would file a still-loading icon under the row's new name. -->
    <template #item-leading="{ item }">
      <UIcon
        :key="item.icon"
        :name="item.icon"
        class="shrink-0 size-5 text-dimmed group-data-highlighted:not-group-data-disabled:text-default transition-colors"
      />
    </template>
    <template #empty="{ searchTerm }">
      <p class="py-6 text-center text-sm text-(--ui-text-muted)">
        Nothing matches “{{ searchTerm }}”.
      </p>
    </template>
  </UCommandPalette>
</template>
