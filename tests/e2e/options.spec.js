import { test, expect } from './fixtures.js';

const optionsUrl = (extensionId) => `chrome-extension://${extensionId}/options.html`;
const stored = async (serviceWorker) => (await serviceWorker.evaluate(() => chrome.storage.local.get('settings'))).settings;
const save = (page) => page.getByRole('button', { name: 'Save' }).click();

// Replaces Chrome's permission prompt: records what is asked and answers `granted`.
async function stubPermissionPrompt(page, granted) {
  await page.evaluate((answer) => {
    window.asked = [];
    chrome.permissions.request = async (permissions) => {
      window.asked.push(permissions);
      return answer;
    };
  }, granted);
}

// Replaces Chrome's on-device translator in the settings page, which the test browser lacks.
async function fakeTranslatorHere(page, availability) {
  await page.evaluate((value) => {
    window.fakeAI = { creates: [], availability: value };
    globalThis.Translator = {
      availability: async () => window.fakeAI.availability,
      create: async ({ sourceLanguage, targetLanguage, monitor }) => {
        window.fakeAI.creates.push(`${sourceLanguage}>${targetLanguage}`);
        const progress = new EventTarget();
        monitor?.(progress);
        progress.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded: 1 }));
        window.fakeAI.availability = 'available';
        return { translate: async (text) => `[${targetLanguage} on device] ${text}` };
      },
    };
  }, availability);
}

test('opens on the free translator with nothing to fill in', async ({ page, extensionId }) => {
  await page.goto(optionsUrl(extensionId));
  await expect(page.locator('#provider')).toHaveValue('chrome');
  await expect(page.locator('#dataNote')).toHaveText(
    'Nothing you translate leaves this computer. Chrome downloads its translation models once, without your text.',
  );
  await expect(page.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute(
    'href',
    'https://github.com/AleksandrIlinykh/paragloss/blob/main/PRIVACY.md',
  );
  await expect(page.locator('#provider option')).toHaveCount(13);
  await expect(page.locator('#provider optgroup')).toHaveCount(4);
  await expect(page.locator('#providerHint')).toContainText('Chrome translates on this computer');
  await expect(page.locator('#apiFields')).toBeHidden();
  await expect(page.locator('#targetLang')).toHaveValue('ru');
  await expect(page.locator('#targetLang option')).toHaveCount(13);
});

test('Test on the free translator downloads the model from English and translates the sample', async ({ page, extensionId, server }) => {
  await page.goto(optionsUrl(extensionId));
  await fakeTranslatorHere(page, 'downloadable');
  await page.getByRole('button', { name: 'Test' }).click();
  await expect(page.locator('#status')).toContainText('Works');
  await expect(page.locator('#status')).toContainText('[ru on device] The quick brown fox jumps over the lazy dog.');
  expect(await page.evaluate(() => window.fakeAI.creates)).toEqual(['en>ru']);
  expect(server.requests).toHaveLength(0);
});

test('Test on the free translator into English starts from German', async ({ page, extensionId }) => {
  await page.goto(optionsUrl(extensionId));
  await fakeTranslatorHere(page, 'available');
  await page.locator('#targetLang').selectOption('en');
  await page.getByRole('button', { name: 'Test' }).click();
  await expect(page.locator('#status')).toContainText('[en on device] Der schnelle braune Fuchs');
});

test('Save with the free translator gets the model from English ready', async ({ page, extensionId }) => {
  await page.goto(optionsUrl(extensionId));
  await fakeTranslatorHere(page, 'downloadable');
  await save(page);
  await expect(page.locator('#status')).toHaveText('Saved. The English to Russian model is ready.');
  expect(await page.evaluate(() => window.fakeAI.creates)).toEqual(['en>ru']);
});

test('Test without the built-in translator says so', async ({ page, extensionId }) => {
  await page.goto(optionsUrl(extensionId));
  await page.evaluate(() => delete globalThis.Translator);
  await page.getByRole('button', { name: 'Test' }).click();
  await expect(page.locator('#status')).toHaveText('This browser has no built-in translator. Choose an AI provider in the settings.');
});

test('DeepSeek shows its defaults, a key link and its models', async ({ page, extensionId }) => {
  await page.goto(optionsUrl(extensionId));
  await page.locator('#provider').selectOption('deepseek');
  await expect(page.locator('#apiFields')).toBeVisible();
  await expect(page.locator('#apiKey')).toHaveValue('');
  await expect(page.locator('#model')).toHaveValue('deepseek-flash');
  await expect(page.locator('#modelList option')).toHaveCount(2);
  await expect(page.locator('#baseUrl')).toHaveValue('https://api.deepseek.com');
  await expect(page.locator('#keyLink')).toHaveAttribute('href', 'https://platform.deepseek.com/api_keys');
  await expect(page.locator('#targetLang')).toHaveValue('ru');
  await expect(page.locator('#targetLang option')).toHaveCount(13);
});

test('each provider keeps its own key, model and URL while switching, and all are saved', async ({ page, extensionId, serviceWorker }) => {
  await page.goto(optionsUrl(extensionId));
  await page.locator('#provider').selectOption('deepseek');
  await page.locator('#apiKey').fill('sk-deep');
  await page.locator('#provider').selectOption('openai');
  await expect(page.locator('#apiKey')).toHaveValue('');
  await expect(page.locator('#model')).toHaveValue('gpt-6-luna');
  await expect(page.locator('#keyLink')).toHaveAttribute('href', 'https://platform.openai.com/api-keys');
  await page.locator('#apiKey').fill('sk-open');
  await page.locator('#provider').selectOption('deepseek');
  await expect(page.locator('#apiKey')).toHaveValue('sk-deep');
  await page.locator('#provider').selectOption('openai');
  await save(page);
  await expect(page.locator('#status')).toHaveText('Saved');
  expect(await stored(serviceWorker)).toEqual({
    provider: 'openai',
    targetLang: 'ru',
    providers: {
      deepseek: { apiKey: 'sk-deep', model: '', baseUrl: '' },
      openai: { apiKey: 'sk-open', model: '', baseUrl: '' },
    },
  });
});

test('saves trimmed values, and a blank model or URL means the default', async ({ page, extensionId, serviceWorker }) => {
  await page.goto(optionsUrl(extensionId));
  await page.locator('#provider').selectOption('deepseek');
  await page.locator('#apiKey').fill('  sk-test  ');
  await page.locator('#targetLang').selectOption('de');
  await page.locator('#model').fill('');
  await page.locator('#baseUrl').fill('');
  await save(page);
  await expect(page.locator('#status')).toHaveText('Saved');
  await expect(page.locator('#model')).toHaveValue('deepseek-flash');
  await expect(page.locator('#baseUrl')).toHaveValue('https://api.deepseek.com');
  expect(await stored(serviceWorker)).toEqual({
    provider: 'deepseek',
    targetLang: 'de',
    providers: { deepseek: { apiKey: 'sk-test', model: '', baseUrl: '' } },
  });
});

test('shows saved values when opened again', async ({ page, extensionId, server, setSettings }) => {
  await setSettings({ apiKey: 'sk-saved', targetLang: 'ja', model: 'deepseek-v4-pro' });
  await page.goto(optionsUrl(extensionId));
  await expect(page.locator('#apiKey')).toHaveValue('sk-saved');
  await expect(page.locator('#targetLang')).toHaveValue('ja');
  await expect(page.locator('#model')).toHaveValue('deepseek-v4-pro');
  await expect(page.locator('#baseUrl')).toHaveValue(server.url);
});

test('settings saved before providers existed show up under DeepSeek', async ({ page, extensionId, serviceWorker }) => {
  await serviceWorker.evaluate(() =>
    chrome.storage.local.set({ settings: { apiKey: 'sk-old', targetLang: 'de', model: 'deepseek-v4-pro', baseUrl: '' } }),
  );
  await page.goto(optionsUrl(extensionId));
  await expect(page.locator('#provider')).toHaveValue('deepseek');
  await expect(page.locator('#apiKey')).toHaveValue('sk-old');
  await expect(page.locator('#model')).toHaveValue('deepseek-v4-pro');
});

test('a local server needs no key, and its model is left to choose', async ({ page, extensionId }) => {
  await page.goto(optionsUrl(extensionId));
  await page.locator('#provider').selectOption('ollama');
  await expect(page.locator('label[for="apiKey"]')).toHaveText('API key (optional)');
  await expect(page.locator('#keyLink')).toBeHidden();
  await expect(page.locator('#model')).toHaveValue('');
  await expect(page.locator('#model')).toHaveAttribute('placeholder', 'Choose or type a model');
  await expect(page.locator('#baseUrl')).toHaveValue('http://localhost:11434/v1');
  await expect(page.locator('#providerHint')).toContainText('Start Ollama');
});

test('Show reveals the key and Hide masks it again', async ({ page, extensionId }) => {
  await page.goto(optionsUrl(extensionId));
  await page.locator('#provider').selectOption('deepseek');
  await page.locator('#apiKey').fill('sk-visible');
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page.locator('#apiKey')).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide' }).click();
  await expect(page.locator('#apiKey')).toHaveAttribute('type', 'password');
});

test('Load models adds the chat models from the API to the suggestions', async ({ page, extensionId, setSettings }) => {
  await setSettings();
  await page.goto(optionsUrl(extensionId));
  await page.getByRole('button', { name: 'Load models' }).click();
  await expect(page.locator('#modelHint')).toHaveText('Loaded 3 models.');
  const suggestions = await page.locator('#modelList option').evaluateAll((options) => options.map((option) => option.value));
  expect(suggestions).toEqual(['deepseek-flash', 'deepseek-v4-pro', 'mock-gemini', 'mock-large', 'mock-small']);
});

test('Load models explains an API error', async ({ page, extensionId, setSettings }) => {
  await setSettings({ apiKey: 'bad' });
  await page.goto(optionsUrl(extensionId));
  await page.getByRole('button', { name: 'Load models' }).click();
  await expect(page.locator('#modelHint')).toHaveText('Invalid API key. Check it in the settings.');
});

test('Test translates a sentence with what is in the form, before it is saved', async ({ page, extensionId, server, setSettings, serviceWorker }) => {
  await setSettings({ apiKey: 'bad' });
  await page.goto(optionsUrl(extensionId));
  await page.locator('#apiKey').fill('test-key');
  await page.getByRole('button', { name: 'Test' }).click();
  await expect(page.locator('#status')).toContainText('Works');
  await expect(page.locator('#status')).toContainText('[RU] The quick brown fox jumps over the lazy dog.');
  expect(server.requests.at(-1).body.messages[0].content).toContain("Translate the user's text into Russian.");
  expect((await stored(serviceWorker)).providers.deepseek.apiKey).toBe('bad');
});

test('Test says what is wrong', async ({ page, extensionId, setSettings }) => {
  await setSettings({ apiKey: '' });
  await page.goto(optionsUrl(extensionId));
  await page.getByRole('button', { name: 'Test' }).click();
  await expect(page.locator('#status')).toHaveText('DeepSeek API key is not set.');
  await page.locator('#apiKey').fill('bad');
  await page.getByRole('button', { name: 'Test' }).click();
  await expect(page.locator('#status')).toHaveText('Invalid API key. Check it in the settings.');
});

test('saving a custom API URL asks Chrome for access to its host', async ({ page, extensionId, serviceWorker }) => {
  await page.goto(optionsUrl(extensionId));
  await stubPermissionPrompt(page, true);
  await page.locator('#provider').selectOption('custom');
  await page.locator('#baseUrl').fill('https://llm.example.com/v1');
  await page.locator('#model').fill('my-model');
  await save(page);
  await expect(page.locator('#status')).toHaveText('Saved');
  expect(await page.evaluate(() => window.asked)).toEqual([{ origins: ['https://llm.example.com/*'] }]);
  expect((await stored(serviceWorker)).providers.custom).toEqual({
    apiKey: '',
    model: 'my-model',
    baseUrl: 'https://llm.example.com/v1',
  });
});

test('when Chrome is not allowed to reach the host, the settings are saved with a warning', async ({ page, extensionId }) => {
  await page.goto(optionsUrl(extensionId));
  await stubPermissionPrompt(page, false);
  await page.locator('#provider').selectOption('custom');
  await page.locator('#baseUrl').fill('https://llm.example.com/v1');
  await save(page);
  await expect(page.locator('#status')).toHaveText(
    'Saved, but Chrome was not allowed to reach llm.example.com, so requests to it will fail.',
  );
});

test('the status disappears when a field changes', async ({ page, extensionId }) => {
  await page.goto(optionsUrl(extensionId));
  await page.locator('#provider').selectOption('deepseek');
  await save(page);
  await expect(page.locator('#status')).toHaveText('Saved');
  await page.locator('#apiKey').fill('sk-other');
  await expect(page.locator('#status')).toHaveText('');
});

test('the note under the provider says where the text goes, and follows the API URL', async ({ page, extensionId }) => {
  await page.goto(optionsUrl(extensionId));
  await page.locator('#provider').selectOption('anthropic');
  await expect(page.locator('#dataNote')).toContainText('is sent to Anthropic Claude at api.anthropic.com with your key');
  await page.locator('#provider').selectOption('custom');
  await expect(page.locator('#dataNote')).toHaveText('The text you hold Alt over or write in Paragloss will go to the API URL you enter.');
  await page.locator('#baseUrl').fill('https://llm.example.com/v1');
  await expect(page.locator('#dataNote')).toContainText('is sent to Other OpenAI-compatible API at llm.example.com');
});

test('a provider picked while the saved settings are still loading is not overwritten by them', async ({ page, extensionId }) => {
  await page.addInitScript(() => {
    // A slow machine: the settings come 800 ms late.
    const get = chrome.storage.local.get.bind(chrome.storage.local);
    chrome.storage.local.get = (...args) => new Promise((resolve) => setTimeout(() => resolve(get(...args)), 800));
  });
  await page.goto(optionsUrl(extensionId));
  await page.locator('#provider').selectOption('ollama');
  await expect(page.locator('#baseUrl')).toHaveValue('http://localhost:11434/v1');
  await page.waitForTimeout(1000);
  await expect(page.locator('#provider')).toHaveValue('ollama');
});
