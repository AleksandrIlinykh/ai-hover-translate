import { notesBlock } from './notes.js';

// The system prompt carries everything but the text: the instructions, then the site notes, then the words
// around a dictionary phrase. What changes least comes first, so DeepSeek's prefix cache can reuse it.
export function buildMessages(text, languageName, { mode = 'text', context = '', notes = '' } = {}) {
  const withContext = mode === 'dictionary' && Boolean(context);
  const lines = [
    mode === 'dictionary'
      ? "You are a bilingual dictionary. The user's text is a word or a short phrase. " +
        `Reply in ${languageName}, in plain text only: on the first line give ` +
        (withContext ? 'the translation that fits the context below' : 'the most common translation') +
        '; then add up to three lines, one per sense, each as "part of speech: meanings", most common first. ' +
        'Add nothing else.'
      : `You are a professional translator. Translate the user's text into ${languageName}. ` +
        'Output only the translation, with no explanations, notes, or quotes. ' +
        'Preserve the meaning, tone, and line breaks. ' +
        'Leave code, URLs, and names that are normally not translated as they are. ' +
        `If the text is already in ${languageName}, return it unchanged.`,
  ];
  if (notes) lines.push(notesBlock(notes, 'the site this text is from'));
  if (withContext) lines.push(`Context: "${context}"`);
  return [
    { role: 'system', content: lines.join('\n') },
    { role: 'user', content: text },
  ];
}
