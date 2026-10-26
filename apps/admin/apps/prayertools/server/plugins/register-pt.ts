import { registerPermissions, withholdFromAdmin } from '#core/server/utils/permissions-registry'
import { registerDefaultGrants } from '#core/server/utils/default-grants-registry'
import { registerStaticRole } from '#core/server/utils/roles-registry'
import { configureApp, registerApp } from '#core/server/utils/app-registry'
import { registerRailItem } from '#core/server/utils/rail-registry'
import { registerAdminSection } from '#core/server/utils/admin-section-registry'
import { getRegisteredRecordType, registerCrmConsentPurpose, registerCrmRecordType } from '#crm/server'
import { registerAiFeature } from '#ai/server'
import { PT_PERMISSIONS, PT_PERMISSION_META, PT_STATIC_ROLES } from '../../app/utils/pt-permissions'
import { PT_LIBRARY_APP } from '@prayertools/shared/site'

export default defineNitroPlugin(() => {
  registerPermissions(PT_PERMISSIONS, PT_PERMISSION_META)
  registerDefaultGrants('pt', {
    member: ['pt.access', 'pt.site.read', 'pt.stats.read'],
    admin: [...PT_PERMISSIONS]
  })
  for (const role of PT_STATIC_ROLES) {
    registerStaticRole({ ...role, source: 'pt' })
  }

  // Every site has the same apps, turned on when the site is created
  // (PT_ORG_APPS); site owners can't switch them off.
  registerApp({ id: 'site', title: 'Site', path: '/@:orgSlug/site', icon: 'i-lucide-church', requiredPermission: 'pt.access', order: 10, defaultStatus: 'host_controlled' })
  configureApp('crm', { defaultStatus: 'host_controlled' })
  configureApp('inbox', { order: 60, defaultStatus: 'host_controlled' })
  configureApp('marketing', { title: 'Email', order: 70 })
  // The champion's own library (templates, images, blocks) and multi-site
  // sends, the same from every site.
  registerApp({ id: PT_LIBRARY_APP, title: 'Library', path: '/personal', icon: 'i-lucide-library-big', description: 'Your templates, images and blocks, usable on any of your sites.', scope: 'user', permissions: [], defaultStatus: 'default', order: 90 })

  // The rail is the only main navigation; every entry is "this, for the
  // current site". Sections with several pages use in-page tabs.
  const rail: [string, string, string, string, string, number][] = [
    ['site', 'Dashboard', '/@:orgSlug/site', 'i-lucide-layout-dashboard', 'pt.access', 10],
    ['site', 'Campaigns', '/@:orgSlug/site/campaigns', 'i-lucide-calendar-range', 'pt.site.read', 20],
    ['site', 'Content', '/@:orgSlug/site/content', 'i-lucide-book-open', 'pt.site.read', 30],
    ['site', 'Landing page', '/@:orgSlug/site/landing', 'i-lucide-panels-top-left', 'pt.site.read', 40],
    ['crm', 'Intercessors', '/@:orgSlug/crm/contacts', 'i-lucide-users', 'crm.contacts.read', 50],
    ['site', 'Stats', '/@:orgSlug/site/stats', 'i-lucide-chart-line', 'pt.stats.read', 80],
    ['site', 'Team', '/@:orgSlug/site/team', 'i-lucide-user-cog', 'org.members.read', 90],
    ['site', 'Settings', '/@:orgSlug/site/settings', 'i-lucide-settings', 'pt.site.read', 100]
  ]
  for (const [appId, title, path, icon, requiredPermission, order] of rail) {
    registerRailItem({ appId, id: title.toLowerCase().replace(/\s+/g, '-'), title, path, icon, requiredPermission, order })
  }
  // The library is used from inside campaigns and content and reached from
  // Your sites, so it stays off the rail: its only rail item needs a
  // permission no one holds.
  registerRailItem({ appId: PT_LIBRARY_APP, id: 'library', title: 'Library', path: '/personal', requiredPermission: 'pt.library.rail' })

  registerAdminSection({ appId: 'pt', title: 'Sites', path: '/admin/pt/sites', icon: 'i-lucide-church', order: 20 })
  registerAdminSection({ appId: 'pt', title: 'Directory', path: '/admin/pt/directory', icon: 'i-lucide-list-checks', order: 21 })
  registerAdminSection({ appId: 'pt', title: 'Libraries', path: '/admin/pt/libraries', icon: 'i-lucide-library', order: 22 })
  registerAdminSection({ appId: 'pt', title: 'Stories', path: '/admin/pt/stories', icon: 'i-lucide-heart-handshake', order: 23 })
  registerAdminSection({ appId: 'pt', title: 'Reports', path: '/admin/pt/reports', icon: 'i-lucide-flag', order: 24 })
  registerAdminSection({ appId: 'pt', title: 'Jobs', path: '/admin/pt/jobs', icon: 'i-lucide-list-restart', order: 25 })
  registerAdminSection({ appId: 'pt', title: 'Exports', path: '/admin/pt/exports', icon: 'i-lucide-file-down', order: 26 })

  // Intercessors are CRM contacts without the CRM's assignment, nickname and gender fields.
  const contacts = getRegisteredRecordType('contacts')
  if (contacts) {
    const { assigned_to, nickname, gender, ...fields } = contacts.fields
    registerCrmRecordType({ ...contacts, fields })
  }

  // Site owners hold the admin role; the CRM's schema builder and permissions matrix stay hidden from them.
  withholdFromAdmin(['crm.schema.manage'])

  registerCrmConsentPurpose('site_updates', { title: 'Updates from this site', description: 'Campaign news and relaunch invitations from this site.' })
  registerCrmConsentPurpose('platform_news', { title: 'News from Prayer.Tools', description: 'Platform news, held in the staff org.' })

  registerAiFeature({ key: 'pt.translate', label: 'Prayer.Tools — translate content and site text' })
})
