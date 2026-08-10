import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
  // Root scripts use scripts/run-e2e.mjs to own the preview process directly;
  // this avoids an unreapable pnpm/Vite wrapper on Windows. Keep webServer as a
  // fallback for developers invoking the Playwright CLI itself.
  webServer: process.env.KMD_E2E_EXTERNAL_SERVER === '1'
    ? undefined
    : {
        command: 'node packages/reader-runtime-web/node_modules/vite/bin/vite.js preview --config packages/reader-runtime-web/vite.config.ts --host 127.0.0.1 --port 4174',
        url: 'http://127.0.0.1:4174',
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
});
