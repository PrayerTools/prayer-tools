// Which nuxtinator layers the admin app uses. Both nuxt.config.ts (`extends:`)
// and scripts/sync-layers.ts read this list; the resolved refs are recorded in
// layers.lock.json.
//
// prayer.tools' own layers (the prayer.tools layer and the marketing layer)
// live in ./apps/<id>/ and are globbed into `extends` by nuxt.config.ts.
//
// Load order: core, tenancy (its multi-mode kernel overrides core's),
// social-auth, email backend, ai, crm, inbox.

import type { LayerSpec } from './scripts/lib/resolve'

export const LAYERS: readonly LayerSpec[] = [
  { id: 'core', pkg: '@nuxtinator/core', repo: 'corsacca/nuxtinator', subdir: 'layers/core', version: 'master' },
  { id: 'tenancy', pkg: '@nuxtinator/tenancy', repo: 'corsacca/nuxtinator', subdir: 'layers/tenancy', version: 'master' },
  { id: 'social-auth', pkg: '@nuxtinator/social-auth', repo: 'corsacca/nuxtinator', subdir: 'layers/social-auth', version: 'master' },
  { id: 'email-mailgun', pkg: '@nuxtinator/email-mailgun', repo: 'corsacca/nuxtinator', subdir: 'layers/email-mailgun', version: 'master' },
  { id: 'ai', pkg: '@nuxtinator/ai', repo: 'corsacca/nuxtinator', subdir: 'layers/ai', version: '^0.6.1' },
  { id: 'crm', pkg: '@nuxtinator/crm', repo: 'corsacca/nuxtinator', subdir: 'layers/apps/crm', version: 'master' },
  { id: 'inbox', pkg: '@nuxtinator/inbox', repo: 'corsacca/nuxtinator', subdir: 'layers/apps/inbox', version: 'master' }
]
