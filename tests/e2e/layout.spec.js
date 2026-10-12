import { test, expect, altHover, popupText, popupBox } from './fixtures.js';

const GAP = 6;

test.beforeEach(async ({ page, server, setSettings }) => {
  await setSettings();
  await page.goto(`${server.url}/page.html`);
});

// A paragraph of known geometry on top of the fixture content (left and width are CSS lengths).
async function addBlock(page, { left, top, width, chars }) {
  await page.evaluate(
    ({ left, top, width, chars }) => {
      const block = document.createElement('p');
      block.id = 'probe';
      block.style.cssText = `position: absolute; left: ${left}; top: ${top}px; width: ${width}; margin: 0; font: 16px/24px sans-serif; background: #fff; z-index: 10;`;
      block.textContent = 'Lorem ipsum dolor sit amet. '.repeat(Math.ceil(chars / 28)).trim();
      document.body.append(block);
    },
    { left, top, width, chars },
  );
}

async function openOnProbe(page) {
  await altHover(page, '#probe');
  await expect(popupText(page)).toContainText('[RU] Lorem ipsum');
  await page.keyboard.up('Alt');
}

async function geometry(page) {
  const block = await page.locator('#probe').boundingBox();
  const popup = await popupBox(page).boundingBox();
  return { block, popup };
}

test('a wide paragraph gets a popup capped at 720 px', async ({ page }) => {
  await addBlock(page, { left: '100px', top: 300, width: '1000px', chars: 600 });
  await openOnProbe(page);
  await expect.poll(async () => Math.round((await geometry(page)).popup.width)).toBe(720);
});

test('a medium paragraph gets a popup as wide as the paragraph', async ({ page }) => {
  await addBlock(page, { left: '100px', top: 300, width: '600px', chars: 400 });
  await openOnProbe(page);
  await expect.poll(async () => Math.round((await geometry(page)).popup.width)).toBe(600);
});

test('a narrow column gets a popup at least 320 px wide, still above it', async ({ page }) => {
  await addBlock(page, { left: '100px', top: 300, width: '200px', chars: 150 });
  await openOnProbe(page);
  await expect
    .poll(async () => {
      const { block, popup } = await geometry(page);
      return { width: Math.round(popup.width), above: popup.y + popup.height <= block.y };
    })
    .toEqual({ width: 320, above: true });
});

test('a tall narrow block gets the popup on its right, aligned to its top', async ({ page }) => {
  await addBlock(page, { left: '100px', top: 100, width: '200px', chars: 600 });
  await openOnProbe(page);
  await expect
    .poll(async () => {
      const { block, popup } = await geometry(page);
      return {
        tall: block.height > 240,
        x: Math.round(popup.x - (block.x + block.width)),
        y: Math.round(popup.y - block.y),
        width: Math.round(popup.width),
      };
    })
    .toEqual({ tall: true, x: GAP, y: 0, width: 320 });
});

test('a tall block with no room on its right keeps the popup above or below it', async ({ page }) => {
  await addBlock(page, { left: '8px', top: 150, width: 'calc(100% - 16px)', chars: 2000 });
  await openOnProbe(page);
  await expect
    .poll(async () => {
      const { block, popup } = await geometry(page);
      const outside = popup.y + popup.height <= block.y || popup.y >= block.y + block.height;
      return { tall: block.height > 240, outside };
    })
    .toEqual({ tall: true, outside: true });
});
