import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  // PW_CHANNEL=chrome runs the tests in an installed Chrome instead of Playwright's own browser.
  use: { baseURL: 'http://localhost:4175', viewport: { width: 1400, height: 900 } },
  projects: [
    { name: 'chromium', use: { channel: process.env.PW_CHANNEL } },
    // Safari's engine, for what browsers do differently (dragging a column's heading). CI's
    // Playwright image has WebKit; the cloud environment has only Chromium, so it runs in CI.
    ...(process.env.CI ? [{ name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1400, height: 900 } }, grep: /by mouse/ }] : []),
  ],
  // The built site, as it is published. The tests supply the listings.
  webServer: { command: 'npx vite build && npx vite preview --port 4175 --strictPort', url: 'http://localhost:4175', reuseExistingServer: false },
});
