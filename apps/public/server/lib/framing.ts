// Who may frame a site page: any website the embed widget, the admin app's
// landing-page editor any page it opens with its token, and only the site
// itself every other page. Pure, so it is unit-tested.
export type FramedAs = 'embed' | 'editor' | 'page'

export function frameHeaders(framedAs: FramedAs, adminOrigin: string): { 'content-security-policy': string, 'x-frame-options': string | null } {
  if (framedAs === 'embed') return { 'content-security-policy': 'frame-ancestors *', 'x-frame-options': null }
  if (framedAs === 'editor') return { 'content-security-policy': `frame-ancestors ${adminOrigin}`, 'x-frame-options': null }
  return { 'content-security-policy': "frame-ancestors 'self'", 'x-frame-options': 'SAMEORIGIN' }
}
