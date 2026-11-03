// First-party analytics client: posts only to this site's own /api/collect.
const VID_KEY = 'pt_vid'
let memoryVid: string | null = null

function uuid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}

// Visitor id in first-party storage; framed or storage-partitioned pages fall
// back to session storage, then memory.
export function visitorId(): string {
  for (const store of ['localStorage', 'sessionStorage'] as const) {
    try {
      const s = window[store]
      let v = s.getItem(VID_KEY)
      if (!v) {
        v = uuid()
        s.setItem(VID_KEY, v)
      }
      return v
    } catch {
      // storage blocked; try the next one
    }
  }
  memoryVid ??= uuid()
  return memoryVid
}

const TOKEN_PAGES = new Set(['m', 'u', 'l', 'verify', 'checkin', 'preview', 'ics'])

// The page URL without personal tokens.
export function safeUrl(): string {
  const segs = location.pathname.split('/')
  const i = segs.findIndex(s => TOKEN_PAGES.has(s))
  const path = i >= 0 ? segs.slice(0, i + 1).join('/') : location.pathname
  return `${location.origin}${path}${location.search}`
}

export function trackEvent(eventType: string, metadata: Record<string, unknown> = {}, value?: number): void {
  if (typeof window === 'undefined') return
  const body = JSON.stringify({
    event_type: eventType,
    url: safeUrl(),
    anonymous_hash: visitorId(),
    language: document.documentElement.lang,
    value: value ?? null,
    metadata
  })
  try {
    void fetch('/api/collect', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true })
  } catch {
    // analytics is non-critical
  }
}
