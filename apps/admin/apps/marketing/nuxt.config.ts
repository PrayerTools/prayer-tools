// Marketing layer: per-org campaign email built on the CRM (composer, Tiptap
// templates, audiences, senders, consent, one-click unsubscribe), plus
// multi-org sends owned by a user. Ported from Doxa's marketing system.
// Host-specific behaviour (audiences, branding, sending) comes from the
// `MarketingHost` the host registers through `#marketing/server`.
import { fileURLToPath } from 'node:url'

const layerRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineNuxtConfig({
  modules: [fileURLToPath(new URL('./modules/marketing-mcp.ts', import.meta.url))],

  alias: {
    '#marketing/server': fileURLToPath(new URL('./server/exports/index.ts', import.meta.url))
  },

  nitro: {
    typescript: {
      tsConfig: {
        compilerOptions: {
          paths: {
            '#marketing/server': [`${layerRoot}server/exports/index.ts`]
          }
        }
      }
    }
  }
})
