// Marketing layer: per-org campaign email built on the CRM (composer, Tiptap
// templates, audiences, senders, consent, one-click unsubscribe), plus
// multi-org sends owned by a user. Ported from Doxa's marketing system.
// Host-specific behaviour (audiences, branding, sending) comes from the
// `MarketingHost` the host registers through `#marketing/server`; content it
// can insert into the email editor through `#marketing`.
import { fileURLToPath } from 'node:url'

const layerRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineNuxtConfig({
  modules: [fileURLToPath(new URL('./modules/marketing-mcp.ts', import.meta.url))],

  alias: {
    '#marketing': fileURLToPath(new URL('./app/utils/marketing-inserters.ts', import.meta.url)),
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
