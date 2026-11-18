import { defineConfig } from 'vitest/config'
import { testDb } from '../../../../scripts/test-db'

const db = testDb()

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL: db.adminUrl,
      APP_DATABASE_URL: db.appUrl,
      PT_SECRET: 'test-secret',
      PT_SITE_BASE_HOST: 'localhost:3380',
      PT_ADMIN_URL: 'http://localhost:2380',
      MAIL_TRANSPORT: 'log',
      NUXT_SECRET_ENCRYPTION_KEY: '0f'.repeat(32),
      INBOX_SLUG_ADDRESSES: 'true'
    }
  }
})
