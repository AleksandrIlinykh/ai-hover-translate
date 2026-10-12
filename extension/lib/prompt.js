export function buildMessages(text, languageName, mode = 'text') {
  const system =
    mode === 'dictionary'
      ? "You are a bilingual dictionary. The user's text is a word or a short phrase. " +
        `Reply in ${languageName}, in plain text only: on the first line give the most common translation; ` +
        'then add up to three lines, one per sense, each as "part of speech: meanings", most common first. ' +
        'Add nothing else.'
      : `You are a professional translator. Translate the user's text into ${languageName}. ` +
        'Output only the translation, with no explanations, notes, or quotes. ' +
        'Preserve the meaning, tone, and line breaks. ' +
        'Leave code, URLs, and names that are normally not translated as they are. ' +
        `If the text is already in ${languageName}, return it unchanged.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: text },
  ];
}
