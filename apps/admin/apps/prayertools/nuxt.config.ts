// The prayer.tools layer: sites, domains, campaigns, setup, content,
// libraries, landing page, intercessors, commitments and stats. A site is a
// Nuxtinator org; everything here is scoped to the active org through the
// tenancy kernel.
import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  modules: [fileURLToPath(new URL('./modules/pt-mcp.ts', import.meta.url))],

  runtimeConfig: {
    public: {
      // The champion's library is a personal app: its pages stay at this path
      // in every site.
      personalApps: { library: '/personal' }
    }
  }
})
