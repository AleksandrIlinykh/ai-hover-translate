import { test, expect, altHover, popupBox, popupText } from './fixtures.js';

const hero = (page) => page.locator('#spotslate-hero');

// The pup's box, rounded to whole pixels.
async function heroBox(page) {
  const box = await hero(page).boundingBox();
  return box && { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
}

// Where the pup stands relative to the popup: [its left minus the popup's left, the popup's top minus its bottom].
async function perch(page) {
  const [pup, box] = await Promise.all([heroBox(page), popupBox(page).boundingBox()]);
  return pup && box && [pup.x - Math.round(box.x), Math.round(box.y) - (pup.y + pup.height)];
}

test.beforeEach(async ({ setSettings }) => {
  await setSettings();
});

test('holding Alt brings a dancing pup, about 30 pixels big, next to the mouse, and it follows', async ({ page, server }) => {
  await page.goto(`${server.url}/page.html`);
  await page.mouse.move(60, 150);
  await expect(hero(page)).toHaveCount(0);
  await page.keyboard.down('Alt');
  await expect(hero(page)).toHaveAttribute('data-mood', 'dance');
  await expect.poll(() => heroBox(page)).toEqual({ x: 72, y: 166, width: 32, height: 32 });
  await page.mouse.move(120, 220, { steps: 3 });
  await expect.poll(() => heroBox(page)).toMatchObject({ x: 132, y: 236 });
});

test('letting Alt go with nothing translated sends the pup away', async ({ page, server }) => {
  await page.goto(`${server.url}/page.html`);
  await page.mouse.move(60, 150);
  await page.keyboard.down('Alt');
  await expect(hero(page)).toHaveCount(1);
  await page.keyboard.up('Alt');
  await expect(hero(page)).toHaveCount(0);
});

test('a key combination with Alt brings no pup', async ({ page, server }) => {
  await page.goto(`${server.url}/page.html`);
  await page.mouse.move(60, 150);
  await page.keyboard.down('Control');
  await page.keyboard.down('Alt');
  await page.waitForTimeout(300);
  await expect(hero(page)).toHaveCount(0);
});

test('the pup sits down once the translation is there, and hops onto the popup when Alt is let go', async ({ page, server }) => {
  await page.goto(`${server.url}/page.html`);
  await altHover(page, '#p1');
  await expect(popupText(page)).toHaveText('[RU] The quick brown fox jumps over the lazy dog. Read more');
  await expect(hero(page)).toHaveAttribute('data-mood', 'idle');
  await page.keyboard.up('Alt');
  await expect.poll(() => perch(page)).toEqual([10, 0]);
  await expect(hero(page)).toHaveAttribute('data-mood', 'idle');
});

test('the pup dances on the popup while the translation is on its way', async ({ page, server, setSettings }) => {
  await setSettings({ apiKey: 'late' });
  await page.goto(`${server.url}/page.html`);
  await altHover(page, '#p1');
  await expect(popupBox(page)).toHaveClass(/is-loading/);
  await page.keyboard.up('Alt');
  await expect.poll(() => perch(page)).toEqual([10, 0]);
  await expect(hero(page)).toHaveAttribute('data-mood', 'dance');
  await expect(popupText(page)).toContainText('[RU]');
  await expect(hero(page)).toHaveAttribute('data-mood', 'idle');
});

test('with no room above the popup the pup sits under it', async ({ page, server }) => {
  await page.goto(`${server.url}/page.html`);
  await altHover(page, '#top');
  await expect(popupText(page)).toContainText('[RU]');
  await page.keyboard.up('Alt');
  await expect
    .poll(async () => {
      const [pup, box] = await Promise.all([heroBox(page), popupBox(page).boundingBox()]);
      return pup.y - Math.round(box.y + box.height);
    })
    .toBe(0);
});

test('the pup leaves with the popup', async ({ page, server }) => {
  await page.goto(`${server.url}/page.html`);
  await altHover(page, '#p1');
  await expect(popupText(page)).toContainText('[RU]');
  await page.keyboard.up('Alt');
  await expect.poll(() => perch(page)).toEqual([10, 0]);
  await page.keyboard.press('Escape');
  await expect(hero(page)).toHaveCount(0);
});

test('the pup never takes the mouse from the page', async ({ page, server }) => {
  await page.goto(`${server.url}/page.html`);
  await page.mouse.move(60, 150);
  await page.keyboard.down('Alt');
  await expect.poll(() => heroBox(page)).toMatchObject({ x: 72, y: 166 });
  expect(await page.evaluate(() => document.elementFromPoint(88, 182)?.id ?? '')).not.toBe('spotslate-hero');
});

test('with reduced motion the pup stands still', async ({ page, server }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${server.url}/page.html`);
  await page.mouse.move(60, 150);
  await page.keyboard.down('Alt');
  await expect(hero(page)).toHaveAttribute('data-mood', 'dance');
  const strip = hero(page).locator('.strip-dance');
  expect(await strip.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await strip.evaluate((element) => getComputedStyle(element).animationName)).not.toBe('none');
});
