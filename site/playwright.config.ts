import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  // PW_CHANNEL=chrome runs the tests in an installed Chrome instead of Playwright's own browser.
  use: { baseURL: 'http://localhost:4175', viewport: { width: 1400, height: 900 }, channel: process.env.PW_CHANNEL },
  // The built site, as it is published. The tests supply the listings.
  webServer: { command: 'npx vite build && npx vite preview --port 4175 --strictPort', url: 'http://localhost:4175', reuseExistingServer: false },
});
