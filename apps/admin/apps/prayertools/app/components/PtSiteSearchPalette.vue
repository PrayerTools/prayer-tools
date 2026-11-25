<script setup lang="ts">
// The search box's results: the user's sites and their campaigns and, while
// a site is open, its pages and tabs and every setting (the chosen campaign's
// own on its page). With nothing typed it lists the open site's pages, or the
// sites when none is open.
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui'
import type { PtSearchEntry } from '../utils/pt-site-search'
import type { PtCampaignSummary } from '../utils/pt-campaign-ui'

interface SearchSite { slug: string, name: string, status: string, url: string }
type SearchCampaign = PtCampaignSummary & { id: string, name: string, siteSlug: string, siteName: string, draft: boolean, status: string, ended_at: string | null, timezone: string }

const emit = defineEmits<{ close: [] }>()
const route = useRoute()
// The palette mounts each time it opens and closes on navigation, so the open site is fixed while it shows.
const openSite = String(route.params.orgSlug ?? '')
const { data, status } = useFetch<{ sites: SearchSite[], campaigns: SearchCampaign[] }>('/api/pt/sites/campaigns', { key: 'pt-search-sites' })

function go(site: string, to: string, query?: Record<string, string>) {
  emit('close')
  navigateTo({ path: `/@${site}${to}`, query })
}

const onlyWhenTyped = (term: string, items: CommandPaletteItem[]) => term ? items : []

const siteItems = computed<CommandPaletteItem[]>(() => (data.value?.sites ?? []).map(s => ({
  label: s.name,
  description: [s.status === 'published' ? null : PT_LABELS.siteStatus[s.status], s.url.replace(/^https?:\/\//, '')].filter(Boolean).join(' · '),
  icon: 'i-lucide-church',
  keywords: s.slug,
  onSelect: () => go(s.slug, '/site')
})))

// The open site's campaigns first, finished ones last.
const campaignItems = computed<CommandPaletteItem[]>(() => [...(data.value?.campaigns ?? [])]
  .sort((a, b) => Number(a.siteSlug !== openSite) - Number(b.siteSlug !== openSite) || Number(a.status === 'ended') - Number(b.status === 'ended'))
  .map(c => ({
    label: c.name,
    description: [c.siteName, c.draft ? 'Draft' : null, ptCampaignDates(c)].filter(Boolean).join(' · '),
    icon: 'i-lucide-calendar-range',
    onSelect: () => go(c.siteSlug, `/site/campaigns/${c.id}`)
  })))

const siteGroups = openSite ? useOpenSiteGroups() : computed<CommandPaletteGroup[]>(() => [])

const groups = computed<CommandPaletteGroup[]>(() => [
  ...siteGroups.value.slice(0, 1),
  { id: 'sites', label: 'Sites', items: siteItems.value, postFilter: openSite ? onlyWhenTyped : undefined },
  { id: 'campaigns', label: 'Campaigns', items: campaignItems.value, postFilter: onlyWhenTyped },
  ...siteGroups.value.slice(1)
])

// Pages and Settings of the open site, filtered by what the user may open there.
function useOpenSiteGroups() {
  const { can, isOwner } = usePtSite()
  const { id: campaignId, campaign } = usePtCampaign()

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
      onSelect: () => go(openSite, to, e.query)
    }
  }

  return computed<CommandPaletteGroup[]>(() => [
    { id: 'pages', label: 'Pages', items: PT_SEARCH_PAGES.filter(allowed).map(toItem) },
    { id: 'settings', label: 'Settings', items: ptSearchSettings().filter(allowed).map(toItem), postFilter: onlyWhenTyped }
  ])
}

const fuse = { fuseOptions: { threshold: 0.2, keys: ['keywords'] } }
</script>

<template>
  <UCommandPalette
    :groups="groups"
    :fuse="fuse"
    :loading="status === 'pending' && !data"
    :placeholder="openSite ? 'Search pages, settings, sites and campaigns…' : 'Search your sites and campaigns…'"
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
