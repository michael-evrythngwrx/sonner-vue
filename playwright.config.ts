import { defineConfig, devices } from '@playwright/test';

// Port of sonner-react/playwright.config.ts — see test-contract.md §1.
// D5: the playground (Vite) dev server binds port 3000 via `strictPort` (playground/vite.config.ts)
// so `baseURL` stays http://localhost:3000, matching upstream's Next.js dev server port with a
// minimal-diff config.
export default defineConfig({
  testDir: './test/e2e',
  timeout: 30 * 1000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    trace: 'on-first-retry',
    baseURL: 'http://localhost:3000',
  },
  webServer: {
    command: 'pnpm --filter playground dev',
    url: 'http://localhost:3000',
    cwd: '.',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
