import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: {
      PT_SECRET: 'test-secret'
    }
  }
})
