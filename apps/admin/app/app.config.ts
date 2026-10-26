// Host-level app config: it outranks the layers' own (core declares `rail`
// defaults and loads before prayer.tools' layers).
export default defineAppConfig({
  // The rail starts with Your sites on every page, then lists the current
  // site's sections; org settings are not offered to site owners.
  rail: {
    launcher: { title: 'Your sites', icon: 'i-lucide-church', path: '/orgs' },
    orgSettings: false
  }
})
