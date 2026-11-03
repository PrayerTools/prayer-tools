export const PT_PERMISSIONS = [
  'pt.access',
  'pt.site.read',
  'pt.setup.read',
  'pt.site.write',
  'pt.site.manage',
  'pt.campaigns.write',
  'pt.messages.write',
  'pt.content.write',
  'pt.content.translate',
  'pt.stats.read',
  'pt.intercessors.read',
  'pt.intercessors.write',
  'pt.intercessors.export',
  'pt.email.send',
  'pt.sites.create',
  'pt.library.write'
] as const

// Granted through the champion's Library personal app rather than a site
// role, so they hold in every site and before the first one exists.
export const PT_PERSONAL_PERMISSIONS: readonly PtPermission[] = ['pt.sites.create', 'pt.library.write']

export type PtPermission = typeof PT_PERMISSIONS[number]

export const PT_PERMISSION_META: Record<PtPermission, { title: string, description: string }> = {
  'pt.access': { title: 'Open the site', description: 'Required to open the site in the admin app.' },
  'pt.site.read': { title: 'View site setup', description: 'See campaigns, content, landing page and settings.' },
  'pt.setup.read': { title: 'Show site setup', description: 'Content, Landing page and Settings in the menu.' },
  'pt.site.write': { title: 'Edit site', description: 'Edit the site, landing page, languages, branding and settings.' },
  'pt.site.manage': { title: 'Manage site', description: 'Domains, sending identity, publishing, archiving and deleting the site.' },
  'pt.campaigns.write': { title: 'Edit campaigns', description: 'Create, schedule, relaunch and close campaigns.' },
  'pt.messages.write': { title: 'Edit campaign messages', description: 'Share messages, the end-of-campaign message and call to action, and publishing stories.' },
  'pt.content.write': { title: 'Edit content', description: 'Choose libraries and edit prayer content.' },
  'pt.content.translate': { title: 'Translate content', description: 'Edit translations of content and custom sections.' },
  'pt.stats.read': { title: 'View stats', description: 'See counts and activity (no personal data).' },
  'pt.intercessors.read': { title: 'View intercessors', description: 'See intercessors and their details.' },
  'pt.intercessors.write': { title: 'Edit intercessors', description: 'Change intercessors\' subscriptions and prayer times.' },
  'pt.intercessors.export': { title: 'Export intercessors', description: 'Download the intercessor CSV.' },
  'pt.email.send': { title: 'Send site email', description: 'Write and send site emails and test emails.' },
  'pt.sites.create': { title: 'Create sites', description: 'Create new prayer sites.' },
  'pt.library.write': { title: 'Edit your library', description: 'Create and edit your own prayer libraries and images.' }
}

// Site roles. The owner is the tenancy `admin` role (every permission);
// editor, mobilizer, translator and viewer ship here as fixed roles.
export const PT_ROLE_KEYS = ['admin', 'pt-editor', 'pt-mobilizer', 'pt-translator', 'pt-viewer'] as const
export type PtRoleKey = typeof PT_ROLE_KEYS[number]

const VIEWER: string[] = ['pt.access', 'pt.site.read', 'pt.stats.read', 'org.members.read']
// Shows Content, Landing page and Settings in the rail; the mobilizer leaves those to others.
const SETUP = 'pt.setup.read'

export const PT_STATIC_ROLES: { key: Exclude<PtRoleKey, 'admin'>, name: string, description: string, permissions: string[] }[] = [
  {
    key: 'pt-editor',
    name: 'Editor',
    description: 'Content, email, settings, and intercessors including their details.',
    permissions: [
      ...VIEWER, SETUP,
      'pt.site.write', 'pt.campaigns.write', 'pt.messages.write', 'pt.content.write', 'pt.content.translate',
      'pt.intercessors.read', 'pt.intercessors.write', 'pt.intercessors.export', 'pt.email.send',
      'crm.access', 'crm.contacts.read', 'crm.contacts.create', 'crm.contacts.update', 'crm.contacts.view_all',
      'inbox.access', 'inbox.send',
      'marketing.access', 'marketing.send'
    ]
  },
  {
    key: 'pt-mobilizer',
    name: 'Mobilizer',
    description: 'Invites people and talks with intercessors: share and thank-you messages, stories, email and the inbox.',
    permissions: [
      ...VIEWER,
      'pt.intercessors.read', 'pt.intercessors.write', 'pt.intercessors.export', 'pt.email.send', 'pt.messages.write',
      'crm.access', 'crm.contacts.read', 'crm.contacts.update', 'crm.contacts.view_all',
      'inbox.access', 'inbox.send',
      'marketing.access', 'marketing.send'
    ]
  },
  {
    key: 'pt-translator',
    name: 'Translator',
    description: 'Edits the translations of content and custom sections.',
    permissions: [...VIEWER, SETUP, 'pt.content.translate']
  },
  {
    key: 'pt-viewer',
    name: 'Viewer',
    description: 'Stats only, no personal data.',
    permissions: [...VIEWER, SETUP]
  }
]

// Held by everyone the personal library is on for; gates the library's share
// routes.
export const PT_LIBRARY_SHARE = 'pt.library.share'

declare module '#permissions' {
  interface PermissionRegistry extends Record<PtPermission | typeof PT_LIBRARY_SHARE, true> {}
}
