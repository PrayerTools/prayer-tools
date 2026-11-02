// Builds the page view for SSR requests on site and platform hosts, so the
// catch-all page renders from the request context without a second request.
import { applyViewHeaders, buildView } from '../utils/page-view'
import { setFrameHeaders } from '../utils/framing'

const SKIP = ['/api/', '/ics/', '/v1/', '/.well-known/', '/_nuxt/', '/__nuxt']

export default defineEventHandler(async (event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') return
  const kind = event.context.hostKind
  if (kind !== 'site' && kind !== 'custom' && kind !== 'platform') return
  const pathname = event.path.split('?')[0]!
  if (SKIP.some(p => pathname.startsWith(p))) return
  // Files (robots.txt, embed.js, …); signed tokens also contain a dot but
  // end in a long signature.
  if (/\.[a-z0-9]{2,11}$/i.test(pathname)) return
  const rewritten = event.context.viewPath as string | undefined
  const view = await buildView(event, rewritten ?? event.path)
  if (event.context.viewStatus) view.status = event.context.viewStatus as number
  event.context.ptView = view
  setResponseStatus(event, view.status)
  applyViewHeaders(event, view)
  if (view.host === 'site' && view.page.kind === 'embed' && !event.context.site?.editor) setFrameHeaders(event, 'embed')
})
