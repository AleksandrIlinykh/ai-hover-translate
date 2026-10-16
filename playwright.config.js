import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 30_000,
  // Waits for what the extension shows: twice Playwright's 5 s, so a busy machine slowing Chromium down for a moment
  // fails no test, while a real fault still fails at once.
  expect: { timeout: 10_000 },
  reporter: 'list',
});
