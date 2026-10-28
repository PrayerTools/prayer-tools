import type { PtCampaign } from '../utils/pt-campaign-ui'

// The campaign that Content, Landing page, Share, Stats and Test emails edit,
// chosen with PtCampaignSwitcher. `?campaign=<id>` selects one. The browser
// remembers the choice per site until that campaign ends; without one it is
// the campaign on the site's root address.
export function usePtCampaign() {
  const route = useRoute()
  const router = useRouter()
  const { data: site, slug } = usePtSite()
  const { data: list, status, refresh } = useFetch<{ campaigns: PtCampaign[] }>('/api/pt/campaigns', { key: 'pt-campaigns' })
  const chosen = useState<Record<string, string>>('pt-campaign-choice', () => ({}))
  const storageKey = computed(() => `pt-campaign:${slug.value}`)

  function remembered(): string | null {
    try {
      return localStorage.getItem(storageKey.value)
    } catch {
      return null
    }
  }

  function select(next: string) {
    chosen.value = { ...chosen.value, [slug.value]: next }
    try {
      localStorage.setItem(storageKey.value, next)
    } catch {
      // The choice still holds for this visit.
    }
  }

  const campaigns = computed(() => list.value?.campaigns ?? [])
  const id = computed<string | undefined>(() => {
    const all = campaigns.value
    const explicit = chosen.value[slug.value]
    if (explicit && all.some(c => c.id === explicit)) return explicit
    const stored = all.find(c => c.id === remembered())
    if (stored && stored.status !== 'ended') return stored.id
    const current = site.value?.currentCampaign?.id
    return all.find(c => c.id === current)?.id ?? all[0]?.id
  })
  const campaign = computed(() => campaigns.value.find(c => c.id === id.value) ?? null)

  watch(() => route.query.campaign, (q) => {
    if (typeof q !== 'string') return
    select(q)
    const { campaign: _taken, ...rest } = route.query
    router.replace({ query: rest })
  }, { immediate: true })

  return { id, campaign, campaigns, select, status, refresh }
}
