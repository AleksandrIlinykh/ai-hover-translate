// The page SpotSlate opens on install: the language to translate into, a paragraph and a field to try the gestures
// on (the content scripts run on this page too), and what leaves the computer.
import { LANGUAGES, loadSettings, withDefaults } from './lib/settings.js';
import { currentPlatform, formatShortcut, readKeyName } from './lib/keys.js';

// Something to translate: English, or German for someone who translates into English.
const PRACTICE = {
  en:
    'Hold Alt over this paragraph. SpotSlate shows its translation right above it, and a little dog keeps you ' +
    'company while it works. Select a word first to get a short dictionary entry instead.',
  de:
    'Halten Sie Alt über diesen Absatz. SpotSlate zeigt die Übersetzung direkt darüber, und ein kleiner Hund ' +
    'leistet Ihnen dabei Gesellschaft. Markieren Sie zuerst ein Wort, um einen kurzen Wörterbucheintrag zu bekommen.',
};

const { languageName } = globalThis.spotslate;
const select = document.getElementById('targetLang');
const practice = document.getElementById('practice');
const settings = await loadSettings();

function showPractice(targetLang) {
  const lang = targetLang === 'en' ? 'de' : 'en';
  practice.lang = lang;
  practice.textContent = PRACTICE[lang];
}

for (const code of Object.keys(LANGUAGES)) select.add(new Option(languageName(code, code, { capitalized: true }), code));
select.value = settings.targetLang;
showPractice(settings.targetLang);
document.getElementById('saved').hidden = location.hash !== '#saved';

const platform = currentPlatform();
for (const key of document.querySelectorAll('.readKey')) key.textContent = readKeyName(settings.keys.read, platform);
document.getElementById('writeKey').textContent = formatShortcut(settings.keys.write, platform);

// Saved at once; the page reloads so that SpotSlate on it speaks and translates into the new language.
select.addEventListener('change', async () => {
  await chrome.storage.local.set({ settings: withDefaults({ ...(await loadSettings()), targetLang: select.value }) });
  location.hash = '#saved';
  location.reload();
});

document.getElementById('openSettings').addEventListener('click', () => chrome.runtime.openOptionsPage());
