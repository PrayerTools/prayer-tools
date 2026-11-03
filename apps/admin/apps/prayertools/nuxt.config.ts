// The prayer.tools layer: sites, domains, campaigns, setup, content,
// libraries, landing page, intercessors, commitments and stats. A site is a
// Nuxtinator org; everything here is scoped to the active org through the
// tenancy kernel.
import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  modules: [fileURLToPath(new URL('./modules/pt-mcp.ts', import.meta.url))],

  runtimeConfig: {
    public: {
      // Both library areas are shared across sites. Keep their bare URLs while
      // retaining the last active site's navigation in the surrounding chrome.
      personalApps: { library: '/personal', prayerLibraries: '/libraries' }
    }
  }
})
