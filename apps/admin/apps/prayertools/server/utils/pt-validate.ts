import type { TranslatableText, LandingCustomSection, CampaignBranding, CampaignLanding, CampaignShare, SiteBranding, SiteEmailIdentity, TiptapDoc } from '@prayertools/shared/db/schema'
import { parseText } from '@prayertools/shared/translatable'
import { parseHex } from '@prayertools/shared/colors'
import { HIDEABLE_SECTIONS } from '@prayertools/shared/landing'
import { videoEmbed } from '@prayertools/shared/video'

const MAX_DOC_BYTES = 200_000

export function ptDoc(input: unknown): TiptapDoc | null {
  if (!input || typeof input !== 'object') return null
  const d = input as TiptapDoc
  if (d.type !== 'doc' || (d.content !== undefined && !Array.isArray(d.content))) return null
  if (JSON.stringify(d).length > MAX_DOC_BYTES) ptBadRequest('Content is too long.')
  return d
}

function str(v: unknown, max = 500): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined
}

function url(v: unknown): string | undefined {
  const s = str(v, 2000)
  return s && /^(https?:\/\/|\/)/.test(s) ? s : undefined
}

function unit(v: unknown): number | undefined {
  return typeof v === 'number' && v >= 0 && v <= 1 ? v : undefined
}

function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as T
}

export function ptBranding(input: unknown): SiteBranding {
  const b = (input ?? {}) as Record<string, unknown>
  const color = str(b.color, 9)
  if (color && !parseHex(color)) ptBadRequest('Brand color must be a hex color.')
  return clean({
    color,
    logo_url: url(b.logo_url),
    logo_asset_id: str(b.logo_asset_id, 40)
  })
}

export function ptCampaignBranding(input: unknown): CampaignBranding {
  const b = (input ?? {}) as Record<string, unknown>
  return clean({
    image_url: url(b.image_url),
    image_asset_id: str(b.image_asset_id, 40),
    image_alt: parseText(b.image_alt) ?? undefined,
    image_credit: str(b.image_credit, 200),
    focal_x: unit(b.focal_x),
    focal_y: unit(b.focal_y),
    share_image_url: url(b.share_image_url)
  })
}

export function ptIdentity(input: unknown): SiteEmailIdentity {
  const i = (input ?? {}) as Record<string, unknown>
  const replyTo = str(i.reply_to, 254)
  if (replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) ptBadRequest('Reply-to must be an email address.')
  const local = str(i.from_local, 64)?.toLowerCase()
  if (local && !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(local)) ptBadRequest('The sending address may only use letters, digits, dots, hyphens and underscores.')
  return clean({
    from_name: str(i.from_name, 80),
    from_local: local,
    reply_to: replyTo,
    logo_url: url(i.logo_url),
    signature: parseText(i.signature) ?? undefined
  })
}

export function ptLanding(input: unknown): CampaignLanding {
  const l = (input ?? {}) as Record<string, unknown>
  const why: Record<string, TiptapDoc> = {}
  for (const [lang, doc] of Object.entries((l.why ?? {}) as Record<string, unknown>)) {
    const d = ptDoc(doc)
    if (d) why[lang] = d
  }
  const hidden = Array.isArray(l.hidden) ? (l.hidden as unknown[]).filter((s): s is string => typeof s === 'string' && (HIDEABLE_SECTIONS as readonly string[]).includes(s)) : undefined
  const custom: LandingCustomSection[] = []
  for (const raw of Array.isArray(l.custom) ? (l.custom as Record<string, unknown>[]).slice(0, 12) : []) {
    const heading = parseText(raw.heading)
    if (!heading) continue
    const body: Record<string, TiptapDoc> = {}
    for (const [lang, doc] of Object.entries((raw.body ?? {}) as Record<string, unknown>)) {
      const d = ptDoc(doc)
      if (d) body[lang] = d
    }
    custom.push(clean({
      id: str(raw.id, 40) ?? crypto.randomUUID(),
      heading,
      body,
      image_url: url(raw.image_url),
      image_alt: parseText(raw.image_alt) ?? undefined,
      video_url: videoEmbed(url(raw.video_url)) ? url(raw.video_url) : undefined,
      button_label: parseText(raw.button_label) ?? undefined,
      button_url: url(raw.button_url)
    }) as LandingCustomSection)
  }
  return clean({ why, hidden, custom, stories: typeof l.stories === 'boolean' ? l.stories : undefined })
}

export function ptShare(input: unknown): CampaignShare {
  const s = (input ?? {}) as Record<string, unknown>
  return clean({ messages: parseText(s.messages) ?? undefined })
}

export function ptFieldOptions(input: unknown): { key: string, label: TranslatableText }[] {
  const list = Array.isArray(input) ? input.slice(0, 20) : []
  const out: { key: string, label: TranslatableText }[] = []
  for (const o of list as Record<string, unknown>[]) {
    const label = parseText(o.label)
    const key = String(o.key ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40)
    if (label && key && !out.some(x => x.key === key)) out.push({ key, label })
  }
  return out
}
