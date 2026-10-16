import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Each test has a browser, a mock server and a profile of its own, so tests can run side by side: two in CI, on a
  // machine of its own; one locally, where the other apps share the processor and slow parallel browsers down.
  fullyParallel: true,
  workers: process.env.CI ? 2 : 1,
  timeout: 30_000,
  // Waits for what the extension shows: twice Playwright's 5 s, so a busy machine slowing Chromium down for a moment
  // fails no test, while a real fault still fails at once.
  expect: { timeout: 10_000 },
  reporter: 'list',
});
