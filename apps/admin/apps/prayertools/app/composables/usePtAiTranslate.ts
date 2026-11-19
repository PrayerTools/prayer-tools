// Whether AI translate buttons should show: in the active site, or with `library`
// in library editing (outside any site), which uses the host's AI key.
export function usePtAiTranslate(scope: 'site' | 'library' = 'site') {
  const route = useRoute()
  const endpoint = scope === 'library' ? '/api/pt/libraries/translate' : '/api/pt/translate'
  const key = computed(() => scope === 'library' ? 'pt-ai-translate-library' : `pt-ai-translate-${String(route.params.orgSlug ?? '')}`)
  const { data } = useFetch<{ available: boolean }>(endpoint, { key, dedupe: 'defer' })
  return computed(() => !!data.value?.available)
}
