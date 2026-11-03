// Which nuxtinator layers the admin app uses. Both nuxt.config.ts (`extends:`)
// and scripts/sync-layers.ts read this list; the resolved refs are recorded in
// layers.lock.json.
//
// prayer.tools' own layers (the prayer.tools layer and the marketing layer)
// live in ./apps/<id>/ and are globbed into `extends` by nuxt.config.ts.
//
// Load order: core, tenancy (its multi-mode kernel overrides core's),
// social-auth, email backend, oauth, mcp, ai, crm, inbox.

import type { LayerSpec } from './scripts/lib/resolve'

// Every layer is pinned to this Nuxtinator commit: the first with zod 4 in all
// layers, which no tagged release includes yet.
const NUXTINATOR_REF = '7fad3e3c14cdb21336c5a6bb97885d204bf6a024'

export const LAYERS: readonly LayerSpec[] = [
  { id: 'core', pkg: '@nuxtinator/core', repo: 'corsacca/nuxtinator', subdir: 'layers/core', version: NUXTINATOR_REF },
  { id: 'tenancy', pkg: '@nuxtinator/tenancy', repo: 'corsacca/nuxtinator', subdir: 'layers/tenancy', version: NUXTINATOR_REF },
  { id: 'social-auth', pkg: '@nuxtinator/social-auth', repo: 'corsacca/nuxtinator', subdir: 'layers/social-auth', version: NUXTINATOR_REF },
  { id: 'email-mailgun', pkg: '@nuxtinator/email-mailgun', repo: 'corsacca/nuxtinator', subdir: 'layers/email-mailgun', version: NUXTINATOR_REF },
  { id: 'oauth', pkg: '@nuxtinator/oauth', repo: 'corsacca/nuxtinator', subdir: 'layers/oauth', version: NUXTINATOR_REF },
  { id: 'mcp', pkg: '@nuxtinator/mcp', repo: 'corsacca/nuxtinator', subdir: 'layers/mcp', version: NUXTINATOR_REF },
  { id: 'ai', pkg: '@nuxtinator/ai', repo: 'corsacca/nuxtinator', subdir: 'layers/ai', version: NUXTINATOR_REF },
  { id: 'crm', pkg: '@nuxtinator/crm', repo: 'corsacca/nuxtinator', subdir: 'layers/apps/crm', version: NUXTINATOR_REF },
  { id: 'inbox', pkg: '@nuxtinator/inbox', repo: 'corsacca/nuxtinator', subdir: 'layers/apps/inbox', version: NUXTINATOR_REF }
]
