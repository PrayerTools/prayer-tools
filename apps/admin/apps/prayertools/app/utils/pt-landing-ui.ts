// Landing page editor copy: what each fixed section shows, its icon, and the
// guidance a campaign template gives for the champion's own "why" text.

const SECTION_INFO: Record<string, { description: string, icon: string }> = {
  top: { description: 'Heading, subtitle, hero image, people count or goal progress, and the signup button.', icon: 'i-lucide-panel-top' },
  why: { description: 'Your own words about why people should pray.', icon: 'i-lucide-message-square-quote' },
  custom: { description: 'Extra sections you add, each with a heading, text, image or video, and button.', icon: 'i-lucide-layout-list' },
  stories: { description: 'Stories from people who prayed, ones you publish from the Stories page.', icon: 'i-lucide-heart-handshake' },
  how: { description: 'Explains signing up, reminders and praying, written for your campaign\'s setup.', icon: 'i-lucide-list-checks' },
  signup: { description: 'The signup form.', icon: 'i-lucide-user-plus' },
  today: { description: 'A preview of today\'s prayer content.', icon: 'i-lucide-book-open' },
  share: { description: 'Invites visitors to share the campaign.', icon: 'i-lucide-share-2' },
  contact: { description: 'A link to your contact form.', icon: 'i-lucide-mail' },
  app: { description: 'A link to the Prayer.Tools app, shown once the app is available.', icon: 'i-lucide-smartphone' }
}

export const PT_LANDING_SECTION_INFO: Record<string, { title: string, description: string, icon: string }> = Object.fromEntries(
  Object.entries(SECTION_INFO).map(([key, info]) => [key, { title: PT_LABELS.landingSection[key] ?? key, ...info }])
)

// The editor block for the selected section.
export const PT_LANDING_SELECTED = 'ring-2 ring-(--ui-primary) bg-(--ui-primary)/5 dark:ring-amber-400 dark:bg-amber-400/10'

// The site's own wording for each section's standard text (pt_site_string
// keys); the first field is the section heading.
export const PT_LANDING_TEXT_FIELDS: Record<string, { key: string, label: string, multiline?: boolean }[]> = {
  why: [{ key: 'landing.why.title', label: 'Heading' }],
  stories: [{ key: 'landing.stories.title', label: 'Heading' }],
  how: [{ key: 'landing.how.title', label: 'Heading' }, { key: 'landing.how.body', label: 'Text', multiline: true }],
  signup: [{ key: 'landing.signup.title', label: 'Heading' }, { key: 'landing.signup.intro', label: 'Introduction', multiline: true }],
  today: [{ key: 'landing.today.title', label: 'Heading' }],
  share: [{ key: 'landing.share.title', label: 'Heading' }, { key: 'landing.share.body', label: 'Text', multiline: true }],
  contact: [{ key: 'landing.contact.title', label: 'Heading' }, { key: 'landing.contact.body', label: 'Text', multiline: true }],
  app: [{ key: 'landing.app.title', label: 'Heading' }, { key: 'landing.app.body', label: 'Text', multiline: true }]
}

export function ptLandingSectionInfo(key: string) {
  return PT_LANDING_SECTION_INFO[key] ?? { title: PT_LABELS.landingSection[key] ?? key, description: '', icon: 'i-lucide-square' }
}

const GUIDANCE: Record<string, Record<string, string>> = {
  why: {
    generic: 'Tell visitors what you are praying for and why it matters. Two or three short paragraphs work well: who or what you pray for, what you hope God will do, and why each person\'s prayer counts.',
    ramadan: 'During Ramadan many Muslims seek God. Share why you are praying for them this month, what you hope for, and how praying 15 minutes a day makes a difference.',
    disaster_4: 'Say briefly what happened, who is affected, and what you are asking God for in these first days. Keep it short: people should be able to start praying right away.',
    disaster_12: 'Describe the needs as the response continues: people affected, those helping, and the churches serving. Invite visitors to keep praying for the next days.',
    anytime: 'Tell visitors what they will pray for and that they can start today: everyone begins at the first entry on the day they sign up.'
  }
}

export function ptLandingGuidance(key: string, template: string | null | undefined): string | null {
  return GUIDANCE[key]?.[template ?? 'generic'] ?? GUIDANCE[key]?.generic ?? null
}
