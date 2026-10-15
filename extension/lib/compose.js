// Writing in the page's language: the user types in their own language and gets a translation to copy.
import { LANGUAGES } from './settings.js';
import { notesBlock } from './notes.js';

// The prompt for a draft. The system message holds the instructions and the site notes; the user message is
// exactly the draft.
export function buildComposeMessages(draft, fromName, toName, { notes = '' } = {}) {
  const lines = [
    `You help a professional write in ${toName} at work. ` +
      `Translate the user's text from ${fromName} into ${toName} as clear, natural writing for work messages, ` +
      'comments and emails. Keep the meaning, the tone and the line breaks. ' +
      'Leave code, URLs and names that are normally not translated as they are. ' +
      'Output only the translation, with no explanations, notes, or quotes.',
  ];
  if (notes) lines.push(notesBlock(notes, 'the site the user is writing on'));
  return [
    { role: 'system', content: lines.join('\n\n') },
    { role: 'user', content: draft },
  ];
}

// The counts of languages read on a site with one more text in `lang`; no text is kept, only the counts.
export function countLanguage(counts, lang) {
  if (!Object.hasOwn(LANGUAGES, lang)) return counts;
  return { ...counts, [lang]: (counts[lang] ?? 0) + 1 };
}

function mostCommon(counts) {
  return Object.entries(counts ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// The language to write in, never the user's own: the choice saved for the site, the language of what the user
// read there, the page's declared language, the last one chosen anywhere, English, or else the first other one.
export function chooseComposeTarget({ from, saved, readCounts = {}, pageLang, last }) {
  const candidates = [saved, mostCommon(readCounts), pageLang, last, 'en', ...Object.keys(LANGUAGES)];
  return candidates.find((code) => code && code !== from && Object.hasOwn(LANGUAGES, code));
}
