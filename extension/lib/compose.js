// Writing in the page's language: the user types, usually in their own language, and gets a translation to copy; or,
// with the same language on both sides, their own text with its mistakes corrected.
import { LANGUAGES } from './settings.js';
import { notesBlock } from './notes.js';
import { referenceTurns } from './prompt.js';

// The prompt for a draft: the instructions, the site notes as reference (see prompt.js), and exactly the draft.
export function buildComposeMessages(draft, fromName, toName, { notes = '' } = {}) {
  const instructions =
    `You help a professional write in ${toName} at work. ` +
    `Translate the user's text from ${fromName} into ${toName} as clear, natural writing for work messages, ` +
    'comments and emails. Keep the meaning, the tone and the line breaks. ' +
    'Leave code, URLs and names that are normally not translated as they are. ' +
    'Output only the translation, with no explanations, notes, or quotes.';
  const reference = notes ? [notesBlock(notes, 'the site the user is writing on')] : [];
  return [{ role: 'system', content: instructions }, ...referenceTurns(reference), { role: 'user', content: draft }];
}

// The prompt for checking a text the user wrote in a language they are learning: the mistakes only, never the style,
// in the form content/correction.js reads, with the notes in the user's own language (`explainIn`).
export function buildCorrectMessages(draft, languageName, explainIn, { notes = '' } = {}) {
  const instructions =
    `The user is learning ${languageName} and wrote the text in it. ` +
    'Correct only its mistakes: grammar, spelling, punctuation and wrongly used words. ' +
    'Do not rewrite it for style; keep everything else as written, with the line breaks, code, URLs and names. ' +
    'Answer in exactly this form:\n' +
    '<corrected>\nthe whole text, corrected\n</corrected>\n' +
    `<notes>\n- one short line in ${explainIn} for each correction: the change and why\n</notes>\n` +
    'With no mistakes, give the text unchanged and leave the notes empty. Output nothing else.';
  const reference = notes ? [notesBlock(notes, 'the site the user is writing on')] : [];
  return [{ role: 'system', content: instructions }, ...referenceTurns(reference), { role: 'user', content: draft }];
}

// The language the user writes in: the one chosen for the site, else their own.
export function chooseComposeSource({ own, saved }) {
  return saved && Object.hasOwn(LANGUAGES, saved) ? saved : own;
}

// The counts of languages read on a site with one more text in `lang`; no text is kept, only the counts.
export function countLanguage(counts, lang) {
  if (!Object.hasOwn(LANGUAGES, lang)) return counts;
  return { ...counts, [lang]: (counts[lang] ?? 0) + 1 };
}

function mostCommon(counts) {
  return Object.entries(counts ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// The language to write in: the choice saved for the site, whichever it is; else, never the user's own, the language
// of what the user read there, the page's declared language, the last one chosen anywhere, English, or the first other.
export function chooseComposeTarget({ from, saved, readCounts = {}, pageLang, last }) {
  if (saved && Object.hasOwn(LANGUAGES, saved)) return saved;
  const candidates = [mostCommon(readCounts), pageLang, last, 'en', ...Object.keys(LANGUAGES)];
  return candidates.find((code) => code && code !== from && Object.hasOwn(LANGUAGES, code));
}
