import { LANGUAGES, activeProvider, loadSettings, withDefaults } from './lib/settings.js';
import { PROVIDERS, dataNote, hostPattern, modelsRequest, parseModels, setupProblem } from './lib/providers.js';
import { readTextStream, sendChat } from './lib/chat.js';
import { buildMessages } from './lib/prompt.js';
import { errorFromStatus, makeError } from './lib/errors.js';

const TEST_TEXT = 'The quick brown fox jumps over the lazy dog.';
const TEST_TEXT_DE = 'Der schnelle braune Fuchs springt über den faulen Hund.'; // for a test into English
const TIMEOUT_MS = 30_000;
const GROUPS = { free: 'Free, on this computer', cloud: 'Cloud APIs', local: 'Local AI models', other: 'Other' };
const FIELDS = ['apiKey', 'model', 'baseUrl'];

const form = document.getElementById('form');
const status = document.getElementById('status');
const element = (id) => document.getElementById(id);

const drafts = {}; // provider id -> { apiKey, model, baseUrl } as shown, kept while switching providers
const loadedModels = {}; // provider id -> model ids from its API
let current = ''; // the provider on screen

for (const [code, name] of Object.entries(LANGUAGES)) {
  form.elements.targetLang.add(new Option(name, code));
}
for (const [group, label] of Object.entries(GROUPS)) {
  const optgroup = document.createElement('optgroup');
  optgroup.label = label;
  for (const [id, preset] of Object.entries(PROVIDERS)) {
    if (preset.group === group) optgroup.append(new Option(preset.name, id));
  }
  form.elements.provider.append(optgroup);
}

function report(text, isError = false) {
  status.textContent = text;
  status.classList.toggle('error', isError);
}

// Fields show the provider's defaults instead of blanks.
function show(settings) {
  form.elements.targetLang.value = settings.targetLang;
  for (const [id, preset] of Object.entries(PROVIDERS)) {
    const entry = settings.providers[id];
    drafts[id] = { apiKey: entry?.apiKey ?? '', model: entry?.model || preset.model, baseUrl: entry?.baseUrl || preset.baseUrl };
  }
  showProvider(settings.provider);
}

function showProvider(id) {
  const preset = PROVIDERS[id];
  current = id;
  form.elements.provider.value = id;
  for (const field of FIELDS) form.elements[field].value = drafts[id][field];
  form.elements.model.placeholder = preset.model || 'Choose or type a model';
  form.elements.baseUrl.placeholder = preset.baseUrl || 'https://api.example.com/v1';
  form.querySelector('label[for="apiKey"]').textContent = preset.keyRequired ? 'API key' : 'API key (optional)';
  element('keyHint').hidden = !preset.keyUrl;
  element('keyLink').href = preset.keyUrl ?? '';
  element('keyLink').textContent = preset.keyUrl ? new URL(preset.keyUrl).host : '';
  element('apiFields').hidden = preset.api === 'browser';
  element('providerHint').hidden = !preset.hint;
  element('providerHint').textContent = preset.hint ?? '';
  element('modelHint').textContent = '';
  showModelList();
  showDataNote();
}

// Where the text goes with the provider on screen; it follows the API URL as it is typed.
function showDataNote() {
  element('dataNote').textContent = dataNote(providerInForm());
}

function showModelList() {
  const ids = new Set([...PROVIDERS[current].models, ...(loadedModels[current] ?? [])]);
  element('modelList').replaceChildren(...[...ids].map((id) => new Option(id)));
}

// The provider on screen, as background would call it with these fields.
function providerInForm() {
  const settings = withDefaults({ provider: current, providers: { [current]: drafts[current] } });
  return activeProvider(settings);
}

// What to store: defaults left blank, so a changed default reaches everyone; untouched providers left out.
function entriesToStore() {
  const entries = {};
  for (const [id, draft] of Object.entries(drafts)) {
    const preset = PROVIDERS[id];
    const model = draft.model.trim();
    const baseUrl = draft.baseUrl.trim();
    const entry = {
      apiKey: draft.apiKey.trim(),
      model: model === preset.model ? '' : model,
      baseUrl: baseUrl.replace(/\/+$/, '') === preset.baseUrl ? '' : baseUrl,
    };
    if (Object.values(entry).some(Boolean)) entries[id] = entry;
  }
  return entries;
}

// Chrome asks the user before the extension may reach a host outside its manifest. The request has to come
// straight from the click, so callers make it before anything else they await.
function requestHost(provider) {
  const pattern = hostPattern(provider.baseUrl);
  return pattern ? chrome.permissions.request({ origins: [pattern] }).catch(() => false) : Promise.resolve(true);
}

const notAllowed = (provider) => `Chrome was not allowed to reach ${new URL(provider.baseUrl).host}`;

form.elements.provider.addEventListener('change', () => {
  showProvider(form.elements.provider.value);
  report('');
});

form.addEventListener('input', (event) => {
  if (FIELDS.includes(event.target.name)) drafts[current][event.target.name] = event.target.value;
  if (event.target.name === 'baseUrl') showDataNote();
  report('');
});

element('showKey').addEventListener('click', (event) => {
  const hidden = form.elements.apiKey.type === 'password';
  form.elements.apiKey.type = hidden ? 'text' : 'password';
  event.target.textContent = hidden ? 'Hide' : 'Show';
});

element('loadModels').addEventListener('click', async () => {
  const provider = providerInForm();
  const allowed = requestHost(provider);
  const hint = element('modelHint');
  const problem = setupProblem(provider);
  if (problem === 'no_url' || problem === 'no_key') {
    hint.textContent = makeError(problem, provider).message;
    return;
  }
  hint.textContent = 'Loading models...';
  if (!(await allowed)) {
    hint.textContent = `${notAllowed(provider)}.`;
    return;
  }
  try {
    const { url, init } = modelsRequest(provider);
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) {
      hint.textContent = errorFromStatus(response.status, await response.text(), provider).message;
      return;
    }
    const models = parseModels(await response.json());
    loadedModels[provider.id] = models;
    if (current === provider.id) showModelList();
    hint.textContent = models.length > 0 ? `Loaded ${models.length} models.` : 'The API listed no chat models.';
  } catch {
    hint.textContent = makeError('network', provider).message;
  }
});

// The sample for the free translator: English, or German when translating into English.
const browserSample = (targetLang) => (targetLang === 'en' ? [TEST_TEXT_DE, 'de'] : [TEST_TEXT, 'en']);
const modelProgress = (share) => `Downloading the translation model: ${Math.round(share * 100)}%`;

// Saving the free provider gets the model from English ready, so the first translation on a page is instant.
// The Save click lets Chrome download it.
async function prepareBrowserModel(targetLang) {
  const { prepareInBrowser, describeProblem } = globalThis.paragloss;
  const [, sourceLang] = browserSample(targetLang);
  const problem = await prepareInBrowser(sourceLang, targetLang, { onProgress: (share) => report(`Saved. ${modelProgress(share)}`) });
  if (problem) {
    report(`Saved. ${describeProblem({ problem, source: sourceLang }, targetLang).message}`, true);
    return;
  }
  const names = new Intl.DisplayNames(['en'], { type: 'language' });
  report(`Saved. The ${names.of(sourceLang)} to ${names.of(targetLang)} model is ready.`);
}

// The free provider: Chrome's translator, right here. The click lets Chrome download the model.
async function testInBrowser() {
  const targetLang = form.elements.targetLang.value;
  const [text, sourceLang] = browserSample(targetLang);
  const { translateInBrowser, describeProblem } = globalThis.paragloss;
  report('Testing...');
  const started = performance.now();
  const result = await translateInBrowser(text, targetLang, {
    sourceLang,
    onProgress: (share) => report(modelProgress(share)),
  });
  if (result.text === undefined) {
    report(describeProblem(result, targetLang).message, true);
    return;
  }
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  report(`Works, ${seconds} s: ${result.text.trim()}`);
}

// Translates one sentence through the same path as the pages, with the fields as they are now.
element('test').addEventListener('click', async () => {
  if (PROVIDERS[current].api === 'browser') {
    await testInBrowser();
    return;
  }
  const provider = providerInForm();
  const allowed = requestHost(provider);
  const problem = setupProblem(provider);
  if (problem) {
    report(makeError(problem, provider).message, true);
    return;
  }
  report('Testing...');
  if (!(await allowed)) {
    report(`${notAllowed(provider)}.`, true);
    return;
  }
  const started = performance.now();
  try {
    const messages = buildMessages(TEST_TEXT, LANGUAGES[form.elements.targetLang.value]);
    const response = await sendChat(provider, { messages, stream: true }, AbortSignal.timeout(TIMEOUT_MS));
    if (!response.ok) {
      report(errorFromStatus(response.status, await response.text(), provider).message, true);
      return;
    }
    let translation = '';
    await readTextStream(response.body, (chunk) => {
      translation += chunk;
    });
    if (!translation.trim()) {
      report(makeError('empty', provider).message, true);
      return;
    }
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    report(`Works, ${seconds} s: ${translation.trim()}`);
  } catch (error) {
    report(makeError(error?.name === 'TimeoutError' ? 'timeout' : 'network', provider).message, true);
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const provider = providerInForm();
  const allowed = requestHost(provider);
  const settings = withDefaults({ provider: current, targetLang: form.elements.targetLang.value, providers: entriesToStore() });
  await chrome.storage.local.set({ settings });
  show(settings);
  report((await allowed) ? 'Saved' : `Saved, but ${notAllowed(provider)}, so requests to it will fail.`);
  if (provider.api === 'browser') await prepareBrowserModel(settings.targetLang);
});

show(await loadSettings());
element('fields').disabled = false;
