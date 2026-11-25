// What the search box in the top bar finds: every page, tab and setting of a
// site's admin. `to` is the path below the site; entries with `campaign` live
// on the chosen campaign's page, whose id replaces `:id`.

export interface PtSearchEntry {
  label: string
  // The page (and tab) it is on.
  where: string
  to: string
  query?: Record<string, string>
  icon: string
  // Other words people might type for it.
  keywords?: string
  perm?: string
  ownerOnly?: boolean
  campaign?: boolean
}

const SETTINGS = 'Settings › General'
const LANDING = 'Landing page'
const SHARE = 'Share › Link and message'

export const PT_SEARCH_PAGES: PtSearchEntry[] = [
  { label: 'Dashboard', where: 'Site', to: '/site', icon: 'i-lucide-layout-dashboard', keywords: 'home overview still to do', perm: 'pt.access' },
  { label: 'Campaigns', where: 'Site', to: '/site/campaigns', icon: 'i-lucide-calendar-range', keywords: 'dates relaunch end campaign list', perm: 'pt.site.read' },
  { label: 'New campaign', where: 'Campaigns', to: '/site/campaigns/new', icon: 'i-lucide-plus', keywords: 'create add relaunch side campaign start', perm: 'pt.campaigns.write' },
  { label: 'Content', where: 'Site', to: '/site/content', icon: 'i-lucide-book-open', keywords: 'prayer content days library prayer guide fuel', perm: 'pt.setup.read' },
  { label: 'Landing page', where: 'Site', to: '/site/landing', icon: 'i-lucide-panels-top-left', keywords: 'home page sections website', perm: 'pt.setup.read' },
  { label: 'Signup form', where: 'Landing page', to: '/site/landing/signup-form', icon: 'i-lucide-list-checks', keywords: 'sign up questions fields consent register', perm: 'pt.setup.read' },
  { label: 'Stories', where: 'Landing page', to: '/site/landing/stories', icon: 'i-lucide-heart-handshake', keywords: 'testimonies answered prayer', perm: 'pt.intercessors.read' },
  { label: 'Share', where: 'Landing page', to: '/site/landing/share', icon: 'i-lucide-share-2', keywords: 'link qr code message whatsapp social invite promote' },
  { label: 'Embed', where: 'Share', to: '/site/landing/share', query: { tab: 'embed' }, icon: 'i-lucide-code', keywords: 'embed code widget iframe other website' },
  { label: 'Intercessors', where: 'Site', to: '/crm/contacts', icon: 'i-lucide-users', keywords: 'people contacts subscribers signups export', perm: 'crm.contacts.read' },
  { label: 'Inbox', where: 'Site', to: '/inbox', icon: 'i-lucide-inbox', keywords: 'messages replies conversations contact form', perm: 'inbox.access' },
  { label: 'Site email', where: 'Site', to: '/marketing', icon: 'i-lucide-mail', keywords: 'newsletter send email announcement update', perm: 'marketing.access' },
  { label: 'Test emails & push', where: 'Site email', to: '/marketing/test-emails', icon: 'i-lucide-mail-check', keywords: 'preview reminder email push notification app', perm: 'marketing.access' },
  { label: 'Stats', where: 'Site', to: '/site/stats', icon: 'i-lucide-chart-line', keywords: 'numbers prayers minutes visitors signups progress', perm: 'pt.stats.read' },
  { label: 'Team', where: 'Site', to: '/site/team', icon: 'i-lucide-user-cog', keywords: 'members invite roles owner editor mobilizer translator viewer', perm: 'org.members.read' },
  { label: 'Settings', where: 'Site', to: '/site/settings', icon: 'i-lucide-settings', keywords: 'general preferences', perm: 'pt.setup.read' },
  { label: 'Email settings', where: 'Settings', to: '/site/settings', query: { tab: 'email' }, icon: 'i-lucide-mail', keywords: 'sender identity', perm: 'pt.site.manage' },
  { label: 'Contact form', where: 'Settings', to: '/site/settings', query: { tab: 'contact' }, icon: 'i-lucide-message-square', keywords: 'contact page questions notify', perm: 'pt.setup.read' },
  { label: 'Wording', where: 'Settings', to: '/site/settings', query: { tab: 'wording' }, icon: 'i-lucide-type', keywords: 'text translation strings', perm: 'pt.setup.read' },
  { label: 'Status', where: 'Settings', to: '/site/settings', query: { tab: 'status' }, icon: 'i-lucide-power', keywords: 'publish archive delete directory', perm: 'pt.site.manage' },
  { label: 'Domains', where: 'Settings', to: '/site/settings/domains', icon: 'i-lucide-globe', keywords: 'custom domain dns address url', perm: 'pt.site.manage' }
]

const GENERAL: PtSearchEntry[] = [
  { label: 'Site name', where: SETTINGS, to: '/site/settings', icon: 'i-lucide-info', keywords: 'title rename about', perm: 'pt.setup.read' },
  { label: 'Languages', where: SETTINGS, to: '/site/settings', icon: 'i-lucide-languages', keywords: 'language switcher default language translations', perm: 'pt.setup.read' },
  { label: 'Time zone', where: SETTINGS, to: '/site/settings', icon: 'i-lucide-clock', keywords: 'timezone', perm: 'pt.setup.read' }
]

const SITE_SETTING_ICONS: Record<string, string> = {
  checkins_enabled: 'i-lucide-mail-question',
  show_people_count: 'i-lucide-users',
  show_praying_now: 'i-lucide-activity',
  default_duration_min: 'i-lucide-timer',
  share_prompts: 'i-lucide-share-2',
  auto_ack_contact: 'i-lucide-mail-check'
}

const OTHER_SETTINGS: PtSearchEntry[] = [
  { label: 'From name', where: 'Settings › Email', to: '/site/settings', query: { tab: 'email' }, icon: 'i-lucide-user', keywords: 'sender name', perm: 'pt.site.manage' },
  { label: 'Sending address', where: 'Settings › Email', to: '/site/settings', query: { tab: 'email' }, icon: 'i-lucide-at-sign', keywords: 'from address sender', perm: 'pt.site.manage' },
  { label: 'Reply-to address', where: 'Settings › Email', to: '/site/settings', query: { tab: 'email' }, icon: 'i-lucide-reply', keywords: 'replies', perm: 'pt.site.manage' },
  { label: 'Logo in emails', where: 'Settings › Email', to: '/site/settings', query: { tab: 'email' }, icon: 'i-lucide-image', perm: 'pt.site.manage' },
  { label: 'Email signature', where: 'Settings › Email', to: '/site/settings', query: { tab: 'email' }, icon: 'i-lucide-signature', keywords: 'sign off footer', perm: 'pt.site.manage' },
  { label: 'Who to notify on new submissions', where: 'Settings › Contact form', to: '/site/settings', query: { tab: 'contact' }, icon: 'i-lucide-bell', keywords: 'notifications alerts contact messages', perm: 'pt.setup.read' },
  { label: 'Contact form questions', where: 'Settings › Contact form', to: '/site/settings', query: { tab: 'contact' }, icon: 'i-lucide-list-plus', keywords: 'custom questions fields', perm: 'pt.setup.read' },
  { label: 'Default share message', where: 'Settings › Wording', to: '/site/settings', query: { tab: 'wording' }, icon: 'i-lucide-type', perm: 'pt.setup.read' },
  { label: 'Message after signing up', where: 'Settings › Wording', to: '/site/settings', query: { tab: 'wording' }, icon: 'i-lucide-type', keywords: 'signup success confirmation', perm: 'pt.setup.read' },
  { label: 'Between campaigns: “notify me” text', where: 'Settings › Wording', to: '/site/settings', query: { tab: 'wording' }, icon: 'i-lucide-type', keywords: 'notify me next campaign', perm: 'pt.setup.read' },
  { label: 'Publish the site', where: 'Settings › Status', to: '/site/settings', query: { tab: 'status' }, icon: 'i-lucide-rocket', keywords: 'go live draft status', perm: 'pt.site.manage' },
  { label: 'Archive the site', where: 'Settings › Status', to: '/site/settings', query: { tab: 'status' }, icon: 'i-lucide-archive', keywords: 'end close un-archive status', perm: 'pt.site.manage' },
  { label: 'Preview link', where: 'Settings › Status', to: '/site/settings', query: { tab: 'status' }, icon: 'i-lucide-eye', keywords: 'draft preview', perm: 'pt.site.manage' },
  { label: 'Prayer.Tools directory', where: 'Settings › Status', to: '/site/settings', query: { tab: 'status' }, icon: 'i-lucide-list-plus', keywords: 'listing list app find', perm: 'pt.site.manage' },
  { label: 'Intercessor exports', where: 'Settings › Status', to: '/site/settings', query: { tab: 'status' }, icon: 'i-lucide-file-down', keywords: 'download csv export log', perm: 'pt.site.manage' },
  { label: 'Delete site', where: 'Settings › Status', to: '/site/settings', query: { tab: 'status' }, icon: 'i-lucide-trash-2', keywords: 'remove', perm: 'pt.site.manage', ownerOnly: true },
  { label: 'Add a custom domain', where: 'Settings › Domains', to: '/site/settings/domains', icon: 'i-lucide-globe', keywords: 'dns address url own domain', perm: 'pt.site.manage' },
  { label: 'Color', where: LANDING, to: '/site/landing', icon: 'i-lucide-palette', keywords: 'brand colour theme', perm: 'pt.setup.read' },
  { label: 'Logo', where: LANDING, to: '/site/landing', icon: 'i-lucide-image', keywords: 'brand', perm: 'pt.setup.read' },
  { label: 'Hero image', where: LANDING, to: '/site/landing', icon: 'i-lucide-image', keywords: 'banner picture photo header', perm: 'pt.setup.read' },
  { label: 'Always asked', where: 'Signup form', to: '/site/landing/signup-form', icon: 'i-lucide-list-checks', keywords: 'name email prayer times', perm: 'pt.setup.read' },
  { label: 'Signup questions', where: 'Signup form', to: '/site/landing/signup-form', icon: 'i-lucide-list-plus', keywords: 'your questions custom fields', perm: 'pt.setup.read' },
  { label: 'Consent boxes', where: 'Signup form', to: '/site/landing/signup-form', icon: 'i-lucide-square-check', keywords: 'checkbox permission privacy', perm: 'pt.setup.read' },
  { label: 'Link', where: SHARE, to: '/site/landing/share', icon: 'i-lucide-link', keywords: 'url address copy' },
  { label: 'QR code', where: SHARE, to: '/site/landing/share', icon: 'i-lucide-qr-code', keywords: 'png svg print' },
  { label: 'Search and link preview', where: SHARE, to: '/site/landing/share', icon: 'i-lucide-search', keywords: 'description seo meta google' },
  { label: 'Share message', where: SHARE, to: '/site/landing/share', icon: 'i-lucide-message-circle', keywords: 'whatsapp text invite' },
  { label: 'Share image', where: SHARE, to: '/site/landing/share', icon: 'i-lucide-image', keywords: 'social preview picture facebook' },
  { label: 'Embed code', where: 'Share › Embed', to: '/site/landing/share', query: { tab: 'embed' }, icon: 'i-lucide-code', keywords: 'widget iframe other website' }
]

// The chosen campaign's own settings, on its page.
const CAMPAIGN_SETTINGS: PtSearchEntry[] = [
  { label: 'Campaign name', where: 'Campaign', to: '/site/campaigns/:id', icon: 'i-lucide-pencil', keywords: 'title rename', perm: 'pt.site.read', campaign: true },
  { label: 'Campaign address', where: 'Campaign', to: '/site/campaigns/:id', icon: 'i-lucide-link', keywords: 'slug url path', perm: 'pt.site.read', campaign: true },
  { label: 'Dates and goal', where: 'Campaign', to: '/site/campaigns/:id', icon: 'i-lucide-target', keywords: 'start end date goal rhythm how often days length', perm: 'pt.site.read', campaign: true },
  { label: 'Location', where: 'Campaign', to: '/site/campaigns/:id', icon: 'i-lucide-map-pin', keywords: 'place map country city', perm: 'pt.site.read', campaign: true },
  { label: 'How your place is written', where: 'Campaign', to: '/site/campaigns/:id', icon: 'i-lucide-map-pin', keywords: 'place name wording in of', perm: 'pt.site.read', campaign: true },
  { label: 'People group', where: 'Campaign', to: '/site/campaigns/:id', icon: 'i-lucide-users', keywords: 'people group ethnic', perm: 'pt.site.read', campaign: true },
  { label: 'Campaign time zone', where: 'Campaign', to: '/site/campaigns/:id', icon: 'i-lucide-clock', keywords: 'timezone midnight', perm: 'pt.site.read', campaign: true },
  { label: 'Thank-you message', where: 'Campaign', to: '/site/campaigns/:id', icon: 'i-lucide-heart', keywords: 'end of campaign message button call to action', perm: 'pt.site.read', campaign: true },
  { label: 'Welcome and reminder emails', where: 'Campaign', to: '/site/campaigns/:id', icon: 'i-lucide-mail', keywords: 'email text reminder welcome', perm: 'pt.site.read', campaign: true },
  { label: 'Save as template', where: 'Campaign', to: '/site/campaigns/:id', icon: 'i-lucide-bookmark-plus', keywords: 'template library reuse copy', perm: 'pt.site.read', campaign: true },
  { label: 'Delete campaign', where: 'Campaign', to: '/site/campaigns/:id', icon: 'i-lucide-trash-2', keywords: 'remove', perm: 'pt.campaigns.write', campaign: true }
]

// Every setting below the page level, with the site's own setting switches
// labelled as they are on Settings › General.
export function ptSearchSettings(): PtSearchEntry[] {
  const switches = Object.entries(PT_LABELS.setting).map(([key, label]) => ({
    label,
    where: SETTINGS,
    to: '/site/settings',
    icon: SITE_SETTING_ICONS[key] ?? 'i-lucide-toggle-right',
    perm: 'pt.setup.read'
  }))
  const sections = Object.entries(PT_LANDING_SECTION_INFO).map(([, info]) => ({
    label: info.title,
    where: `${LANDING} › Sections`,
    to: '/site/landing',
    icon: info.icon,
    keywords: info.description,
    perm: 'pt.setup.read'
  }))
  return [...GENERAL, ...switches, ...OTHER_SETTINGS, ...sections, ...CAMPAIGN_SETTINGS]
}
