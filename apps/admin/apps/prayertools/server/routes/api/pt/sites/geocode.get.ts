// Place search for a site's location (OpenStreetMap Nominatim). The client
// searches on demand, not per keystroke, to respect Nominatim's usage policy.
import { requireAuth } from '#core/server/utils/auth'
import { platformConfig } from '@prayertools/shared/config'

interface NominatimPlace {
  display_name: string
  name?: string
  lat: string
  lon: string
  type?: string
  addresstype?: string
}

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const q = String(getQuery(event).q ?? '').trim()
  if (q.length < 2) return { places: [] }
  try {
    const query = new URLSearchParams({ 'q': q.slice(0, 200), 'format': 'jsonv2', 'limit': '6', 'accept-language': 'en' })
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${query}`, {
      headers: { 'User-Agent': `PrayerTools/3 (${platformConfig().adminUrl}; support@prayer.tools)`, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) throw new Error(`Nominatim ${res.status}`)
    const rows = await res.json() as NominatimPlace[]
    return {
      places: rows.map(r => ({
        name: r.name || r.display_name.split(',')[0]!.trim(),
        label: r.display_name,
        kind: r.addresstype ?? r.type ?? null,
        latitude: Math.round(Number(r.lat) * 1e5) / 1e5,
        longitude: Math.round(Number(r.lon) * 1e5) / 1e5
      }))
    }
  } catch (err) {
    console.warn('[geocode]', err)
    throw createError({ statusCode: 502, statusMessage: 'Place search is unavailable right now. You can type the place name instead.' })
  }
})
