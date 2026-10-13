import { test, expect, altHover, popupRoot, popupText } from './fixtures.js';

const SHORT = 'The build pipeline is green again.';
const TOPIC_LINE = 'Page topic: git, continuous integration, devops.';
const topicList = (page) => popupRoot(page).locator('.topic-list');
const dropButton = (page) => popupRoot(page).locator('.drop-topics');
const textOf = (page, selector) => page.locator(selector).evaluate((element) => element.textContent);
const systemPrompt = (request) => request.body.messages[0].content;

async function openOn(page, selector) {
  await altHover(page, selector);
  await expect(popupText(page)).toHaveText(`[RU] ${await textOf(page, selector)}`);
  await page.keyboard.up('Alt');
}

// Translates the first long paragraph and waits for its topic to reach the page.
async function learnTopic(page, server) {
  await openOn(page, '#long');
  await expect.poll(() => server.topicRequests.length).toBe(1);
  await page.waitForTimeout(300);
}

// Selects the first `phrase` in `selector`, then holds Alt over it.
async function altOverPhrase(page, selector, phrase) {
  const rect = await page.locator(selector).evaluate((element, wanted) => {
    element.scrollIntoView({ block: 'center' });
    const node = element.firstChild;
    const start = node.textContent.indexOf(wanted);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + wanted.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    const { x, y, width, height } = range.getBoundingClientRect();
    return { x, y, width, height };
  }, phrase);
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2, { steps: 3 });
  await page.keyboard.down('Alt');
}

test.beforeEach(async ({ page, server, setSettings }) => {
  await setSettings();
  await page.goto(`${server.url}/topics.html`);
});

test('the first long paragraph asks for the page topic once, and later translations send and show it', async ({ page, server }) => {
  await learnTopic(page, server);
  const [{ body }] = server.topicRequests;
  expect(body).toMatchObject({ stream: false, thinking: { type: 'disabled' } });
  expect(body.messages[1].content).toBe(await textOf(page, '#long'));
  expect(systemPrompt(server.requests[0])).not.toContain('Page topic');

  await openOn(page, '#short');
  expect(systemPrompt(server.requests[1])).toContain(TOPIC_LINE);
  await expect(topicList(page)).toHaveText('git · continuous integration · devops');
  await expect(dropButton(page)).toBeVisible();

  await openOn(page, '#long2');
  expect(server.topicRequests).toHaveLength(1);
});

test('the popup of the paragraph that asked for the topic shows no tags', async ({ page, server }) => {
  await learnTopic(page, server);
  await expect(topicList(page)).toBeHidden();
  await expect(dropButton(page)).toBeHidden();
});

test('the drop button forgets the topic and translates the text again without it', async ({ page, server }) => {
  await learnTopic(page, server);
  await openOn(page, '#short');
  await dropButton(page).click();
  await expect(topicList(page)).toBeHidden();
  await expect.poll(() => server.requests.length).toBe(3);
  expect(systemPrompt(server.requests[2])).not.toContain('Page topic');
  await expect(popupText(page)).toHaveText(`[RU] ${SHORT}`);

  await openOn(page, '#long2');
  expect(systemPrompt(server.requests[3])).not.toContain('Page topic');
  await page.waitForTimeout(300);
  expect(server.topicRequests).toHaveLength(1);
});

test('a new address starts without a topic and asks again', async ({ page, server }) => {
  await learnTopic(page, server);
  await page.evaluate(() => history.pushState(null, '', '/topics.html?next'));
  await openOn(page, '#short');
  expect(systemPrompt(server.requests.at(-1))).not.toContain('Page topic');
  await expect(topicList(page)).toBeHidden();
  await openOn(page, '#long2');
  await expect.poll(() => server.topicRequests.length).toBe(2);
});

test('a selected word is sent with at most 8 words around it from its sentence', async ({ page, server }) => {
  await altOverPhrase(page, '#sentence', 'pipeline');
  await expect(popupText(page)).toHaveText('[RU] pipeline');
  const [{ body }] = server.requests;
  expect(body.messages[1].content).toBe('pipeline');
  expect(body.messages[0].content).toContain(
    'Context: "the long weekend merge of the shared build pipeline failed on the main branch and nobody noticed"',
  );
});

test('the same word in another sentence is translated again', async ({ page, server }) => {
  await altOverPhrase(page, '#sentence', 'pipeline');
  await expect(popupText(page)).toHaveText('[RU] pipeline');
  await page.keyboard.up('Alt');
  await altOverPhrase(page, '#short', 'pipeline');
  await expect.poll(() => server.requests.length).toBe(2);
  expect(server.requests[1].body.messages[0].content).toContain('Context: "The build pipeline is green again"');
});
