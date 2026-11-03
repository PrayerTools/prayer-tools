// Public server: site domains, the `api.` and `go.` hosts, and My prayer on
// the platform host. Host routing happens in server middleware; every site
// page is served by one catch-all page that renders a server-built view.
export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',

  modules: ['@nuxt/ui', '@nuxtjs/i18n'],

  devtools: { enabled: false },

  css: ['~/assets/css/main.css'],

  devServer: { port: 3380, host: 'localhost' },

  ui: {
    colorMode: true,
    fonts: false,
    theme: { colors: ['primary', 'neutral', 'success', 'warning', 'error', 'info'] }
  },

  colorMode: { preference: 'light', fallback: 'light', classSuffix: '' },

  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'en',
    detectBrowserLanguage: false,
    locales: [
      { code: 'en', language: 'en', file: 'en.json', dir: 'ltr' },
      { code: 'es', language: 'es', file: 'es.json', dir: 'ltr' },
      { code: 'fr', language: 'fr', file: 'fr.json', dir: 'ltr' },
      { code: 'pt', language: 'pt', file: 'pt.json', dir: 'ltr' },
      { code: 'ar', language: 'ar', file: 'ar.json', dir: 'rtl' }
    ]
  },

  app: {
    head: {
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
      link: [
        { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }
      ]
    }
  },

  vue: {
    compilerOptions: { isCustomElement: (tag: string) => tag === 'feedback-web-component' }
  },

  build: { transpile: ['@prayertools/shared'] },

  vite: {
    server: { allowedHosts: true }
  },

  nitro: {
    externals: { inline: ['@prayertools/shared'] }
  },

  typescript: { strict: true }
})
