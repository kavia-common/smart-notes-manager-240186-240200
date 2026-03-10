/**
 * Playwright config for E2E reproduction of WM-7722.
 * Uses an explicit baseURL (configurable via env) and stores artifacts for debugging.
 */
const { defineConfig, devices } = require('@playwright/test');

const baseURL =
  process.env.E2E_BASE_URL ||
  // Default to QA chat domain because the ticket’s session links are on that host.
  'https://qa.chat.kavia.ai';

module.exports = defineConfig({
  testDir: './tests',
  timeout: 90 * 1000,
  expect: {
    timeout: 15 * 1000,
  },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list'], ['html']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15 * 1000,
    navigationTimeout: 45 * 1000,
    // Session pages sometimes do background work; allow a bit more stability.
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
