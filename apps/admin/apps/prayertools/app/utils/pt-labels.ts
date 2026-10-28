// Display labels for code-owned values (the database stores only keys).
export const PT_LABELS = {
  siteStatus: { draft: 'Draft', published: 'Published', archived: 'Archived' } as Record<string, string>,
  campaignStatus: { upcoming: 'Upcoming', active: 'Active', ended: 'Ended' } as Record<string, string>,
  campaignState: { upcoming: 'Starting soon', active: 'Running', between: 'Between campaigns' } as Record<string, string>,
  subscriptionStatus: { active: 'Active', inactive: 'Inactive', completed: 'Completed', unsubscribed: 'Unsubscribed' } as Record<string, string>,
  startMode: { date: 'On a date', join: 'When each person joins' } as Record<string, string>,
  endMode: { date: 'On a date', none: 'No end', days: 'After the last entry' } as Record<string, string>,
  goal: { people: 'People mobilized', prayer_time: 'Prayer time', coverage: '24/7 coverage' } as Record<string, string>,
  cadence: { daily: 'Daily', weekly: 'Weekly' } as Record<string, string>,
  length: { fixed: 'Fixed', ongoing: 'Ongoing' } as Record<string, string>,
  template: {
    generic: 'Start from scratch',
    ramadan: 'Ramadan',
    disaster_4: 'Natural disaster — 4 days',
    disaster_12: 'Natural disaster — 12 days',
    anytime: 'Start anytime'
  } as Record<string, string>,
  templateDescription: {
    generic: 'You choose the dates, goal and rhythm.',
    ramadan: 'About 30 days of daily prayer through the month of Ramadan.',
    disaster_4: 'A short, urgent campaign after a disaster. Can hand people on to a 12-day campaign.',
    disaster_12: 'Twelve days of daily prayer after a disaster.',
    anytime: 'No start date. Each person begins at day 1 when they sign up.'
  } as Record<string, string>,
  goalDescription: {
    people: 'Count how many people commit to pray. Recommended for most campaigns.',
    prayer_time: 'Aim for an amount of prayer, such as 24 hours of prayer every day.',
    coverage: 'Fill every moment of the day and night with someone praying, from the start date to the end date.'
  } as Record<string, string>,
  license: { own: 'Our own content', permission: 'Used with permission', cc_by: 'CC BY', cc_by_sa: 'CC BY-SA', other: 'Other (described)' } as Record<string, string>,
  // The English headings the public page shows (apps/public i18n `landing.*.title`).
  landingSection: {
    top: 'Top of the page', why: 'Why we pray', custom: 'Custom sections', stories: 'Stories', how: 'How it works', signup: 'Sign up to pray',
    today: 'Today\'s prayer', share: 'Invite others to pray', contact: 'Contact us', app: 'Pray with the app'
  } as Record<string, string>,
  emailKind: {
    reminder: 'Prayer reminder', checkin: 'Check-in', thank_you: 'Thank-you', verify: 'Confirm email', add_times: 'Confirm new prayer times', manage_link: 'Manage link', site_email: 'Site email'
  } as Record<string, string>,
  sessionSource: { porch: 'on the website', manage: 'from the manage page', app: 'in the app', email: 'from an email' } as Record<string, string>,
  role: { 'admin': 'Owner', 'pt-editor': 'Editor', 'pt-translator': 'Translator', 'pt-viewer': 'Viewer', 'member': 'Member' } as Record<string, string>,
  roleDescription: {
    'admin': 'Team, domains, sending identity, deleting the site, and everything an editor can do.',
    'pt-editor': 'Content, email, settings, and intercessors including their details.',
    'pt-translator': 'Edits translations of content and custom sections.',
    'pt-viewer': 'Stats only, no personal data.'
  } as Record<string, string>,
  domainStatus: { pending: 'Waiting for DNS', active: 'Active', failing: 'Not pointing to us' } as Record<string, string>,
  directoryStatus: { requested: 'Waiting for review', listed: 'Listed', unlisted: 'Not listed' } as Record<string, string>,
  weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  setting: {
    checkins_enabled: 'Send check-in emails to people who stop praying (ongoing campaigns)',
    show_people_count: 'Show the number of people signed up',
    show_praying_now: 'Show how many are praying right now',
    default_duration_min: 'Default prayer time (minutes)',
    share_prompts: 'Invite people to share after they sign up and pray',
    auto_ack_contact: 'Confirm to people that their message was received'
  } as Record<string, string>
}

export const PT_TEMPLATE_ICONS: Record<string, string> = {
  generic: 'i-lucide-sparkles',
  ramadan: 'i-lucide-moon-star',
  disaster_4: 'i-lucide-siren',
  disaster_12: 'i-lucide-life-buoy',
  anytime: 'i-lucide-play'
}

export function ptStatusColor(status: string): 'success' | 'warning' | 'neutral' | 'info' | 'error' {
  return ({ published: 'success', active: 'success', listed: 'success', draft: 'warning', upcoming: 'info', pending: 'warning', requested: 'info', archived: 'neutral', ended: 'neutral', inactive: 'neutral', completed: 'info', unsubscribed: 'error', failing: 'error' } as Record<string, 'success' | 'warning' | 'neutral' | 'info' | 'error'>)[status] ?? 'neutral'
}

export function ptFormatDate(value: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  if (!value) return '—'
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, opts).format(d)
}

export function ptTimezones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
  return intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : ['UTC']
}
