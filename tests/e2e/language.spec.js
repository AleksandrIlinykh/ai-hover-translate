import { test, expect, altHover, moveTo, popupRoot, popupText } from './fixtures.js';

// With German as the language to translate into, Paragloss speaks German on the page.
test.beforeEach(async ({ setSettings }) => {
  await setSettings({ targetLang: 'de' });
});

test('the hints over the page are in the language the page is translated into', async ({ page, server }) => {
  await page.goto(`${server.url}/page.html`);
  await moveTo(page, '#comment');
  await page.keyboard.down('Alt');
  await expect(page.locator('#paragloss-highlight')).toContainText('Alt+Klick: in Ihrer Sprache schreiben.');
  await page.keyboard.up('Alt');
  await moveTo(page, '#password');
  await page.keyboard.down('Alt');
  await expect(page.locator('#paragloss-highlight')).toContainText('Eingabefelder werden nicht übersetzt.');
});

test('the popup, its errors and the context panel are in that language', async ({ page, server, setSettings }) => {
  await page.goto(`${server.url}/page.html`);
  await altHover(page, '#p1');
  await expect(popupText(page)).toContainText('[RU] The quick brown fox');
  await expect(popupRoot(page).locator('.copy')).toHaveText('Kopieren');
  await expect(popupRoot(page).locator('.context-toggle')).toHaveText('Kontext');
  await page.keyboard.up('Alt');
  await popupRoot(page).locator('.context-toggle').click();
  await expect(popupRoot(page).locator('.notes-title')).toHaveText(`Kontext für ${new URL(server.url).host}`);
  await expect(popupRoot(page).locator('.notes-clear')).toHaveText('Leeren');
  await page.keyboard.press('Escape');

  await setSettings({ targetLang: 'de', apiKey: '' });
  await page.reload();
  await altHover(page, '#p2');
  await expect(popupText(page)).toHaveText('Der API-Schlüssel für DeepSeek fehlt.');
  await expect(popupRoot(page).locator('.settings')).toHaveText('Einstellungen öffnen');
});

test('the compose window is in that language, with the language names in it too', async ({ page, server }) => {
  await page.goto(`${server.url}/page.html`);
  await moveTo(page, '#comment', { x: 20, y: 10 });
  await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up('Alt');
  const compose = page.locator('#paragloss-compose');
  await expect(compose.locator('.pair')).toHaveText('Deutsch →');
  await expect(compose.locator('.target option:checked')).toHaveText('Englisch');
  await expect(compose.locator('.draft')).toHaveAttribute('placeholder', 'Schreiben Sie in Ihrer Sprache');
  await expect(compose.locator('.check')).toHaveText('Prüfen');
  await expect(compose.locator('.copy')).toHaveText('Kopieren');
});
