// Takes the Chrome Web Store images into store/images/: five 1280x800 screenshots of SpotSlate at work on a made-up
// issue tracker in German (store/demo.html), the 440x280 promo tile and the 1400x560 marquee (store/promo.html).
// A small local server plays the AI provider with fixed English answers. Run `npm run store`.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'store', 'images');
const SIZE = { width: 1280, height: 800 };

const NOTES =
  'An issue tracker of a software team, about a failing build and continuous integration. "Hauptzweig" is the main ' +
  'branch, "Runner" are the CI runners and "Release" is a planned version; keep these terms as they are.';
const DRAFT = "Thanks! I'll check the runner logs tomorrow morning and update the ticket.";
const ANSWERS = [
  [(system) => system.includes('bilingual dictionary'), 'main branch\nnoun: main branch, trunk (in version control)'],
  [(system) => system.includes('You help a professional write in'), 'Danke! Ich prüfe morgen früh die Runner-Logs und aktualisiere das Ticket.'],
  [(system, user) => user.startsWith('Danke! Ich prüfe'), DRAFT],
  [
    (system, user) => user.startsWith('Seit dem Merge'),
    "Since last night's merge, the build on the main branch has been failing. The integration tests time out as soon " +
      "as the runners' cache is cleared. The problem cannot be reproduced locally.",
  ],
  [
    (system, user) => user.startsWith('Bitte prüft'),
    "Please check whether the new version of the test framework is the cause before we approve Thursday's release. " +
      'Until then, the branch stays locked.',
  ],
  [(system, user) => user.startsWith('Ich habe die Runner'), "I restarted the runners, but the error still occurs. I'll attach the logs."],
];

const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.js': 'text/javascript' };

// The project files, and an OpenAI-compatible API with the answers above.
function startServer() {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body.stream) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: NOTES } }] }));
        return;
      }
      const system = body.messages[0].content;
      const user = body.messages.at(-1).content;
      const answer = ANSWERS.find(([when]) => when(system, user))?.[1] ?? user;
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
      for (const piece of answer.match(/.{1,24}/gs)) {
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: piece } }] })}\n\n`);
      }
      res.end('data: [DONE]\n\n');
      return;
    }
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// A copy of the extension with its shadow roots open, so the script can press the buttons inside them.
function extensionCopy() {
  const copy = path.join(os.tmpdir(), `spotslate-store-${process.pid}`);
  fs.rmSync(copy, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'extension'), copy, { recursive: true });
  const config = path.join(copy, 'content', 'config.js');
  fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace("SHADOW_MODE: 'closed'", "SHADOW_MODE: 'open'"));
  return copy;
}

const server = await startServer();
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;
const site = 'http://tracker.example'; // the demo page's address, as the context panel names it
const extension = extensionCopy();
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  viewport: SIZE,
  deviceScaleFactor: 1,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    `--host-resolver-rules=MAP tracker.example 127.0.0.1:${port}`,
  ],
});
const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
const extensionId = new URL(worker.url()).host;
await worker.evaluate(
  (baseUrl) =>
    chrome.storage.local.set({
      settings: { provider: 'deepseek', targetLang: 'en', providers: { deepseek: { apiKey: 'demo', model: '', baseUrl } } },
    }),
  `${origin}/v1`,
);
await new Promise((resolve) => setTimeout(resolve, 1000));
for (const open of context.pages()) if (open.url().endsWith('/welcome.html')) await open.close();

fs.mkdirSync(OUT, { recursive: true });
const page = await context.newPage();
const root = page.locator('#spotslate-root');
const shot = async (name) => {
  await page.waitForTimeout(900); // the dog hops and settles
  await page.screenshot({ path: path.join(OUT, name) });
  console.log(`store/images/${name}`);
};
const demo = (caption) => page.goto(`${site}/store/demo.html?caption=${encodeURIComponent(caption)}`);
const pointAt = async (selector, x = 160, y = 20) => {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + x, box.y + y, { steps: 4 });
};
async function translate(selector, expected) {
  await pointAt(selector);
  await page.keyboard.down('Alt');
  await root.locator('.text').filter({ hasText: expected }).waitFor();
  await page.keyboard.up('Alt');
}

await demo('Hold Alt over a paragraph: its translation appears right above it');
await translate('#p1', 'Since last night');
await shot('1-read.png');

await demo('Select a word: a short dictionary entry that fits the sentence');
const word = await page.evaluate(() => {
  const node = document.getElementById('p1').firstChild;
  const start = node.textContent.indexOf('Hauptzweig');
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + 'Hauptzweig'.length);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
  const rect = range.getBoundingClientRect();
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
});
await page.mouse.move(word.x, word.y, { steps: 4 });
await page.keyboard.down('Alt');
await root.locator('.text').filter({ hasText: 'main branch' }).waitFor();
await page.keyboard.up('Alt');
await shot('2-dictionary.png');

await demo('Terms stay consistent: SpotSlate learns what each site is about');
await translate('#p2', 'Please check');
await root.locator('.context-toggle').click();
await root.locator('.notes-film').filter({ hasText: 'issue tracker' }).waitFor();
await shot('3-context.png');

await demo("Reply in the page's language, and check that the meaning held");
await pointAt('#reply', 40, 20);
await page.keyboard.down('Alt');
await page.mouse.down();
await page.mouse.up();
await page.keyboard.up('Alt');
const compose = page.locator('#spotslate-compose');
await compose.locator('.draft').pressSequentially(DRAFT, { delay: 5 });
await compose.locator('.translation').filter({ hasText: 'Danke!' }).waitFor();
await compose.locator('.check').click();
await compose.locator('.back').filter({ hasText: 'Thanks!' }).waitFor();
await shot('4-write.png');

await worker.evaluate(() =>
  chrome.storage.local.get('settings').then(({ settings }) => chrome.storage.local.set({ settings: { ...settings, provider: 'chrome' } })),
);
await page.goto(`chrome-extension://${extensionId}/welcome.html`);
await page.evaluate(() => (document.body.style.zoom = '0.8')); // the whole page, down to what leaves the computer
await shot('5-private.png');

for (const [size, width, height] of [
  ['small', 440, 280],
  ['large', 1400, 560],
]) {
  await page.setViewportSize({ width, height });
  await page.goto(`${origin}/store/promo.html?size=${size}`);
  await page.screenshot({ path: path.join(OUT, `${size === 'small' ? 'promo' : 'marquee'}-${width}x${height}.png`) });
  console.log(`store/images/${size === 'small' ? 'promo' : 'marquee'}-${width}x${height}.png`);
}

await context.close();
server.close();
