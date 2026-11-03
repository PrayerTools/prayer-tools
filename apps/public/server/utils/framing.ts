import type { H3Event } from 'h3'
import { platformConfig } from '@prayertools/shared/config'
import { frameHeaders, type FramedAs } from '../lib/framing'

export function setFrameHeaders(event: H3Event, framedAs: FramedAs): void {
  for (const [name, value] of Object.entries(frameHeaders(framedAs, new URL(platformConfig().adminUrl).origin))) {
    if (value) setResponseHeader(event, name, value)
    else removeResponseHeader(event, name)
  }
}
