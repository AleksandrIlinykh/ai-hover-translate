import { DEFAULTS, LANGUAGES, loadSettings, withDefaults } from './lib/settings.js';

const form = document.getElementById('form');
const status = document.getElementById('status');
const fields = Object.keys(DEFAULTS);

for (const [code, name] of Object.entries(LANGUAGES)) {
  form.elements.targetLang.add(new Option(name, code));
}

function fill(settings) {
  for (const field of fields) form.elements[field].value = settings[field];
}

fill(await loadSettings());

form.addEventListener('input', () => {
  status.textContent = '';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const settings = withDefaults(Object.fromEntries(fields.map((field) => [field, form.elements[field].value])));
  await chrome.storage.local.set({ settings });
  fill(settings);
  status.textContent = 'Saved';
});
