// This browser's referral code on the current site: saved after signing up,
// or looked up from the manage cookie (a private request, so shared pages
// stay cacheable).
export function useReferral() {
  const { site } = useSite()
  const code = useState<string | null>(`ref:${site.value.orgId}`, () => null)
  onMounted(async () => {
    if (code.value) return
    try {
      code.value = localStorage.getItem(`pt_ref:${site.value.orgId}`)
    } catch {
      // storage blocked
    }
    if (code.value) return
    const me = await fetchMe()
    if (me?.referral_code) code.value = me.referral_code
  })
  return code
}

export function rememberReferral(orgId: string, code: string): void {
  try {
    localStorage.setItem(`pt_ref:${orgId}`, code)
  } catch {
    // storage blocked
  }
}
