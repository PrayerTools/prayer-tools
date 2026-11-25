// Public UI strings a site may reword per language (stored in pt_site_string
// as overrides over the public server's i18n defaults).
export const EDITABLE_SITE_STRINGS = [
  'landing.how.title', 'landing.how.step1', 'landing.how.step2', 'landing.how.step3', 'landing.how.step4', 'landing.signup.title', 'landing.signup.intro', 'landing.share.title',
  'landing.share.body', 'landing.contact.title', 'landing.contact.body', 'landing.why.title', 'landing.about.title', 'landing.stories.title', 'landing.today.title', 'landing.goal.title',
  'landing.app.title', 'landing.app.body', 'share.default_message',
  'signup.success', 'between.notify_intro'
] as const

export type EditableSiteString = typeof EDITABLE_SITE_STRINGS[number]
