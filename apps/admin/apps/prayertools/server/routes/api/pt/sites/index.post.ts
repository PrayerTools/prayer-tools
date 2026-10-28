// Onboarding: creates the site as a draft once the champion has described it.
import { requireAuth } from '#core/server/utils/auth'
import { verifyTurnstile } from '@prayertools/shared/turnstile'
import { rateLimit } from '@prayertools/shared/rate-limit'
import type { CreateSiteInput } from '../../../../utils/pt-sites'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  if (!rateLimit(`site-create:${user.userId}`, 10, 3600_000).ok) {
    throw createError({ statusCode: 429, statusMessage: 'Too many sites created. Try again later.' })
  }
  const body = await readBody(event)
  const name = String(body?.name ?? '').trim()
  const input: CreateSiteInput = {
    name,
    slug: String(body?.slug ?? '').trim().toLowerCase() || await ptFreeSlug(name),
    description: typeof body?.description === 'string' ? body.description.slice(0, 2000) : undefined,
    purpose: typeof body?.purpose === 'string' ? body.purpose : null,
    languages: Array.isArray(body?.languages) ? body.languages : ['en'],
    default_language: typeof body?.default_language === 'string' ? body.default_language : undefined,
    timezone: typeof body?.timezone === 'string' ? body.timezone : 'UTC',
    template_key: typeof body?.template_key === 'string' ? body.template_key : 'generic'
  }
  const errors = ptValidateSiteInput(input)
  if (Object.keys(errors).length) ptBadRequest('Please check the form.', { errors })
  if (!(await verifyTurnstile(body?.turnstile, ptClientIp(event)))) ptBadRequest('Verification failed. Please try again.')
  if (await ptSlugTaken(input.slug)) throw createError({ statusCode: 409, statusMessage: 'That address is already taken.', data: { errors: { slug: 'That address is already taken.' } } })
  return await ptCreateSite(user.userId, input)
})
