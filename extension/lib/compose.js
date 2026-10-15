// Writing in the page's language: the user types in their own language and gets a translation to copy.
import { LANGUAGES } from './settings.js';

const MEMORY_SIZE = 30;
const MIN_WORD = 4;
const STEM = 5;

// The prompt for a draft. The system message holds the instructions, the page topic and, as references,
// texts the user read on the site with their translations, so the same terms come back; the user message
// is exactly the draft.
export function buildComposeMessages(draft, fromName, toName, { topics = [], references = [] } = {}) {
  const lines = [
    `You help a professional write in ${toName} at work. ` +
      `Translate the user's text from ${fromName} into ${toName} as clear, natural writing for work messages, ` +
      'comments and emails. Keep the meaning, the tone and the line breaks. ' +
      'Leave code, URLs and names that are normally not translated as they are. ' +
      'Output only the translation, with no explanations, notes, or quotes.',
  ];
  if (topics.length > 0) lines.push(`Topic of the page the user is writing on: ${topics.join(', ')}.`);
  if (references.length > 0) {
    lines.push(
      `Earlier on this site the user read these texts. Where the user's text speaks of the same things, use the same terms:`,
    );
    for (const { source, translation } of references) {
      lines.push(`${toName}: "${source}"\n${fromName}: "${translation}"`);
    }
  }
  return [
    { role: 'system', content: lines.join('\n\n') },
    { role: 'user', content: draft },
  ];
}

// Word stems for a rough match across endings: lowercase, words of 4+ letters, their first 5 letters.
function stems(text) {
  return new Set((text.toLowerCase().match(/\p{L}+/gu) ?? []).filter((word) => word.length >= MIN_WORD).map((word) => word.slice(0, STEM)));
}

// The read pairs most related to the draft: in the language to write in (or of unknown language), sharing
// the most word stems with it, the newest first among equals, at most `limit` and within `budget` characters.
export function pickReferences(pairs, draft, { to, limit = 3, budget = 2400 } = {}) {
  const wanted = stems(draft);
  const scored = pairs
    .map((pair, index) => ({ pair, index, score: [...stems(pair.translation)].filter((stem) => wanted.has(stem)).length }))
    .filter(({ pair, score }) => score > 0 && (pair.lang === to || pair.lang == null))
    .sort((a, b) => b.score - a.score || b.index - a.index);
  const picked = [];
  let used = 0;
  for (const { pair } of scored) {
    const size = pair.source.length + pair.translation.length;
    if (used + size > budget) continue;
    picked.push(pair);
    used += size;
    if (picked.length === limit) break;
  }
  return picked;
}

// The site's memory with one more pair: the newest last, no repeated source, at most 30.
export function rememberPair(pairs, pair) {
  return [...pairs.filter((item) => item.source !== pair.source), pair].slice(-MEMORY_SIZE);
}

function mostCommon(values) {
  const counts = new Map();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// The language to write in, never the user's own: the choice saved for the site, the language of what the user
// read there, the page's declared language, the last one chosen anywhere, English, or else the first other one.
export function chooseComposeTarget({ from, saved, readLangs = [], pageLang, last }) {
  const candidates = [saved, mostCommon(readLangs), pageLang, last, 'en', ...Object.keys(LANGUAGES)];
  return candidates.find((code) => code && code !== from && Object.hasOwn(LANGUAGES, code));
}
