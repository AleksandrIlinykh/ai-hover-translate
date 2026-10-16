// Checking the user's own writing, when the compose window has the same language on both sides: the AI's answer read
// into the corrected text and its notes (the form buildCorrectMessages in lib/compose.js asks for), and what changed,
// word by word, to show it.
(() => {
  const TEXT = /<corrected>\s*([\s\S]*?)\s*(?:<\/corrected>|<notes>|$)/;
  const NOTES = /<notes>([\s\S]*?)(?:<\/notes>|$)/;
  const WORDS = /\S+\s*/g; // each word with the spaces after it

  // { corrected, notes: [line] }; an answer that lost the form is taken as the corrected text, with no notes.
  function parseCorrection(answer) {
    const text = TEXT.exec(answer);
    if (!text) return { corrected: answer.trim(), notes: [] };
    const notes = (NOTES.exec(answer)?.[1] ?? '')
      .split('\n')
      .map((line) => line.trim().replace(/^[-*•]\s*/, ''))
      .filter(Boolean);
    return { corrected: text[1], notes };
  }

  // The corrected text in parts, [{ type: 'same' | 'removed' | 'added', text }], what was removed before what took
  // its place. Words are compared without the spaces after them, and the same words come as the corrected text has
  // them, so the parts other than 'removed' make up `after`.
  function diffWords(before, after) {
    const a = before.match(WORDS) ?? [];
    const b = after.match(WORDS) ?? [];
    const key = (word) => word.trimEnd();
    let start = 0;
    while (start < a.length && start < b.length && key(a[start]) === key(b[start])) start++;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && key(a[endA - 1]) === key(b[endB - 1])) {
      endA--;
      endB--;
    }
    // common[i][j]: how many words of a from start + i and of b from start + j can stay, in order
    const n = endA - start;
    const m = endB - start;
    const common = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        common[i][j] =
          key(a[start + i]) === key(b[start + j]) ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
      }
    }
    const parts = [];
    const push = (type, text) => {
      const last = parts.at(-1);
      if (last?.type === type) last.text += text;
      else parts.push({ type, text });
    };
    for (const word of b.slice(0, start)) push('same', word);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && key(a[start + i]) === key(b[start + j])) {
        push('same', b[start + j]);
        i++;
        j++;
      } else if (j === m || (i < n && common[i + 1][j] >= common[i][j + 1])) {
        push('removed', a[start + i]);
        i++;
      } else {
        push('added', b[start + j]);
        j++;
      }
    }
    for (const word of b.slice(endB)) push('same', word);
    return parts;
  }

  Object.assign((globalThis.spotslate ??= {}), { parseCorrection, diffWords });
})();
