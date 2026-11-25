import { defineConfig, devices } from '@playwright/test'

/** Level 3: projects saved by this editor, opened in the unmodified official Scratch GUI. */
export default defineConfig({
  testDir: '.',
  testMatch: 'official-gui.spec.ts',
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:8611/', ...devices['Desktop Chrome'] },
  webServer: {
    command: 'node scripts/serve.mjs .official-gui/build 8611',
    url: 'http://localhost:8611/index.html',
    reuseExistingServer: !process.env.CI,
  },
})
