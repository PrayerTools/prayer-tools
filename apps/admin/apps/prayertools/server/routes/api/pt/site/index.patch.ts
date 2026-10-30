// Edits the site. Sending identity needs pt.site.manage (owners); everything
// else pt.site.write. Settings keep only values that differ from the code
// defaults.
import { isLanguage } from '@prayertools/shared/languages'
import { isValidTimezone } from '@prayertools/shared/dates'
import { containsBlockedWord } from '@prayertools/shared/moderation'
import { settingsOverrides } from '@prayertools/shared/site'
import { jsonb, pgArray } from '@prayertools/shared/db/json'

export default definePtHandler('pt.site.write', async (event, tx, ctx) => {
  const b = await ptBody(event)
  const site = await ptSite(tx)
  const patch: Record<string, unknown> = {}

  if (typeof b.name === 'string') {
    const name = b.name.trim()
    if (name.length < 2 || name.length > 80) ptBadRequest('Name must be 2–80 characters.')
    if (containsBlockedWord(name)) ptBadRequest('Please choose another name.')
    await tx.updateTable('orgs').set({ name, updated_at: new Date().toISOString() }).where('id', '=', ctx.orgId).execute()
  }
  if ('timezone' in b) {
    if (!isValidTimezone(b.timezone)) ptBadRequest('Unknown timezone.')
    patch.timezone = b.timezone
  }
  if ('languages' in b || 'default_language' in b) {
    const languages = Array.isArray(b.languages) ? [...new Set(b.languages as string[])] : site.languages
    const def = typeof b.default_language === 'string' ? b.default_language : site.default_language
    if (!languages.length || languages.some(l => !isLanguage(l))) ptBadRequest('Choose at least one language.')
    if (!languages.includes(def)) ptBadRequest('The default language must be one of the site languages.')
    patch.languages = pgArray(languages)
    patch.default_language = def
  }
  if ('branding' in b) patch.branding = jsonb(ptBranding(b.branding))
  if ('email_identity' in b) {
    ptNeed(ctx, 'pt.site.manage')
    patch.email_identity = jsonb(ptIdentity(b.email_identity))
  }
  if ('settings' in b && b.settings && typeof b.settings === 'object') {
    patch.settings = jsonb(settingsOverrides({ ...(site.settings as Record<string, unknown>), ...(b.settings as Record<string, unknown>) }))
  }
  if ('onboarding' in b && b.onboarding && typeof b.onboarding === 'object') {
    const o = b.onboarding as Record<string, unknown>
    patch.onboarding = jsonb({ step: typeof o.step === 'string' ? o.step.slice(0, 40) : undefined, completed: o.completed === true })
  }
  if (Object.keys(patch).length) {
    await tx.updateTable('pt_site').set({ ...patch, updated_at: new Date() } as never).where('org_id', '=', ctx.orgId).execute()
  }
  return { ok: true }
})
