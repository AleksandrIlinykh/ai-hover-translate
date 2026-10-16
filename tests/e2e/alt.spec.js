import { test, expect } from './fixtures.js';

test.beforeEach(async ({ setSettings }) => {
  await setSettings();
});

// On Windows Chrome focuses its menu when Alt is let go alone. SpotSlate keeps it from doing so after a deliberate
// hold, even with nothing translated, and leaves a quick tap to Chrome, where it opens the menu from the keyboard.
test('letting Alt go after holding it is kept from Chrome, a quick tap is not', async ({ page, server }) => {
  await page.goto(`${server.url}/page.html`);
  await page.evaluate(() => {
    window.altUps = [];
    addEventListener('keyup', (event) => event.key === 'Alt' && window.altUps.push(event.defaultPrevented));
  });
  await page.mouse.move(60, 150); // over nothing to translate
  await page.keyboard.down('Alt');
  await page.waitForTimeout(400);
  await page.keyboard.up('Alt');
  await page.keyboard.down('Alt');
  await page.keyboard.up('Alt');
  expect(await page.evaluate(() => window.altUps)).toEqual([true, false]);
});
