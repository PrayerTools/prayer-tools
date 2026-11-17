// Which nuxtinator layers the admin app uses. Both nuxt.config.ts (`extends:`)
// and scripts/sync-layers.ts read this list; the resolved refs are recorded in
// layers.lock.json. With no `version`, a layer resolves to its newest released
// tag at each `layers:update`.
//
// prayer.tools' own layers (the prayer.tools layer and the marketing layer)
// live in ./apps/<id>/ and are globbed into `extends` by nuxt.config.ts.
//
// Load order: core, tenancy (its multi-mode kernel overrides core's),
// social-auth, email backend, oauth, mcp, ai, records (the record kernel crm
// builds on), crm, inbox.

import type { LayerSpec } from './scripts/lib/resolve'

export const LAYERS: readonly LayerSpec[] = [
  { id: 'core', pkg: '@nuxtinator/core', repo: 'Nuxtinator/nuxtinator', subdir: 'layers/core' },
  { id: 'tenancy', pkg: '@nuxtinator/tenancy', repo: 'Nuxtinator/nuxtinator', subdir: 'layers/tenancy' },
  { id: 'social-auth', pkg: '@nuxtinator/social-auth', repo: 'Nuxtinator/nuxtinator', subdir: 'layers/social-auth' },
  { id: 'email-mailgun', pkg: '@nuxtinator/email-mailgun', repo: 'Nuxtinator/nuxtinator', subdir: 'layers/email-mailgun' },
  { id: 'oauth', pkg: '@nuxtinator/oauth', repo: 'Nuxtinator/nuxtinator', subdir: 'layers/oauth' },
  { id: 'mcp', pkg: '@nuxtinator/mcp', repo: 'Nuxtinator/nuxtinator', subdir: 'layers/mcp' },
  { id: 'ai', pkg: '@nuxtinator/ai', repo: 'Nuxtinator/nuxtinator', subdir: 'layers/ai' },
  { id: 'records', pkg: '@nuxtinator/records', repo: 'Nuxtinator/nuxtinator', subdir: 'layers/records' },
  { id: 'crm', pkg: '@nuxtinator/crm', repo: 'Nuxtinator/nuxtinator', subdir: 'layers/apps/crm' },
  { id: 'inbox', pkg: '@nuxtinator/inbox', repo: 'Nuxtinator/nuxtinator', subdir: 'layers/apps/inbox' }
]
