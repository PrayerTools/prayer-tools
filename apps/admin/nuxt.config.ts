import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Nuxt } from '@nuxt/schema'
import { LAYERS } from './layers'
import { subdirOf, type LayerSpec } from './scripts/lib/resolve'

declare const process: { env: Record<string, string | undefined> }

const LAYERS_DIR = '_layers'

// Layers extracted from a full Nuxt project can ship a tsconfig.json that
// references generated paths Vite's tsconfig walker crashes on.
function stripLayerTsconfigs() {
  if (!existsSync(LAYERS_DIR)) return
  for (const name of readdirSync(LAYERS_DIR)) {
    const t = join(LAYERS_DIR, name, 'tsconfig.json')
    if (existsSync(t)) rmSync(t)
  }
}
stripLayerTsconfigs()

// NUXTINATOR_<ID>_PATH points one layer at a local checkout;
// NUXTINATOR_SOURCE_DIR points every layer at a local Nuxtinator repo.
function layer(l: LayerSpec): string {
  const envKey = l.pkg.replace(/^@/, '').replace(/[/-]/g, '_').toUpperCase() + '_PATH'
  if (process.env[envKey]) return process.env[envKey]!
  if (process.env.NUXTINATOR_SOURCE_DIR) return join(process.env.NUXTINATOR_SOURCE_DIR, subdirOf(l))
  return l.pkg
}

// prayer.tools' own layers live in ./apps/<id>/, stacked on top of the fetched ones.
function localApps(): string[] {
  if (!existsSync('apps')) return []
  return readdirSync('apps', { withFileTypes: true })
    .filter(d => d.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(d => `./apps/${d.name}`)
}

export default defineNuxtConfig({

  extends: [...LAYERS.map(l => layer(l)), ...localApps()],

  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    // Typed `$fetch` routes pull server handlers into the app's type program,
    // so the app program also needs every layer's server declarations
    // (database tables, Nitro hooks), which its tsconfig excludes.
    (_options: unknown, nuxt: Nuxt) => {
      nuxt.hook('prepare:types', ({ references }) => {
        for (const l of nuxt.options._layers) {
          const dir = l.config.serverDir ?? join(l.config.rootDir, 'server')
          if (!existsSync(dir)) continue
          for (const f of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
            if (f.endsWith('.d.ts') && !f.includes('node_modules')) references.push({ path: join(dir, f) })
          }
        }
      })
    }
  ],

  hooks: { 'modules:before': stripLayerTsconfigs },

  ssr: false,

  devtools: {
    enabled: false
  },

  app: {
    head: {
      title: process.env.APP_TITLE || 'Prayer.Tools',
      link: [
        { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }
      ]
    }
  },

  ui: {
    theme: {
      colors: ['primary', 'secondary', 'info', 'success', 'warning', 'error', 'neutral']
    }
  },

  build: {
    transpile: ['@prayertools/shared']
  },

  nitro: {
    externals: {
      inline: ['@prayertools/shared']
    },
    routeRules: {
      '/api/**': { headers: { 'cache-control': 'private, no-store' } }
    }
  },

  runtimeConfig: {
    appName: process.env.APP_TITLE || 'Prayer.Tools',
    databaseUrl: process.env.DATABASE_URL || '',
    appDatabaseUrl: process.env.APP_DATABASE_URL || '',
    jwtSecret: process.env.JWT_SECRET || '',
    s3Endpoint: process.env.S3_ENDPOINT || '',
    s3Region: process.env.S3_REGION || '',
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    s3BucketName: process.env.S3_BUCKET_NAME || '',
    s3PublicBucketName: process.env.S3_PUBLIC_BUCKET_NAME || '',
    s3PublicBaseUrl: process.env.S3_PUBLIC_BASE_URL || '',
    secretEncryptionKey: process.env.NUXT_SECRET_ENCRYPTION_KEY || '',
    public: {
      appName: process.env.APP_TITLE || 'Prayer.Tools',
      nodeEnv: process.env.NODE_ENV || '',
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || ''
    }
  },

  devServer: {
    port: Number(process.env.NUXT_PORT) || 2380
  },

  vite: {
    // Prebundle every Tiptap entry together so the editor and our extensions
    // share one ProseMirror instance ("different instances of a keyed plugin").
    optimizeDeps: {
      include: [
        '@tiptap/core', '@tiptap/vue-3', '@tiptap/vue-3/menus', '@tiptap/starter-kit', '@tiptap/pm/state', '@tiptap/pm/view',
        '@tiptap/pm/model', '@tiptap/extension-code', '@tiptap/extension-horizontal-rule', '@tiptap/extension-image',
        '@tiptap/extension-mention', '@tiptap/extension-placeholder', '@tiptap/extension-drag-handle-vue-3',
        '@tiptap/markdown', '@tiptap/suggestion', 'dompurify'
      ]
    },
    server: {
      watch: {
        ignored: ['**/_layers/*/node_modules/**', '**/node_modules/**']
      }
    }
  },

  compatibilityDate: '2025-01-15',

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
