(() => {
  const TOLERANCE = 2;
  const MAX_CHARS = 3000;
  const SHORT_CHARS = 40;
  const SHORT_WORDS = 3;
  const LETTER = /\p{L}/u;
  const CONTEXT_WORDS = 8;
  const sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
  const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

  const inside = (rect, x, y) =>
    x >= rect.left - TOLERANCE && x <= rect.right + TOLERANCE && y >= rect.top - TOLERANCE && y <= rect.bottom + TOLERANCE;

  // The user's text selection when the point is over it, as { target: Range, text, selection: true }.
  function selectionAt(x, y) {
    const selection = getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    const text = selection.toString().trim().replace(/\n{3,}/g, '\n\n');
    if (!LETTER.test(text)) return null;
    if (![...range.getClientRects()].some((rect) => inside(rect, x, y))) return null;
    const picked = { target: range.cloneRange(), text, selection: true };
    return text.length > MAX_CHARS ? { ...picked, reason: 'too-long' } : picked;
  }

  // A word or a few: worth a dictionary entry rather than a plain translation.
  function isShortPhrase(text) {
    return text.length <= SHORT_CHARS && text.split(/\s+/).length <= SHORT_WORDS;
  }

  // The phrase at [start, end) of `text` with at most CONTEXT_WORDS words on each side from its own sentence,
  // on one line; '' when there are no other words around it.
  function wordsAround(source, start, end) {
    // Line breaks in a block's text come from the HTML source, not from the author: they end no sentence.
    const text = source.replace(/\s/g, ' ');
    const sentences = [...sentenceSegmenter.segment(text)];
    const first = sentences.findLast((sentence) => sentence.index <= start);
    const last = sentences.findLast((sentence) => sentence.index < end);
    if (!first || !last) return '';
    const from = first.index;
    const words = [...wordSegmenter.segment(text.slice(from, last.index + last.segment.length))]
      .filter((word) => word.isWordLike)
      .map((word) => ({ start: from + word.index, end: from + word.index + word.segment.length }));
    const before = words.filter((word) => word.end <= start).slice(-CONTEXT_WORDS);
    const after = words.filter((word) => word.start >= end).slice(0, CONTEXT_WORDS);
    if (before.length === 0 && after.length === 0) return '';
    return text
      .slice(before[0]?.start ?? start, after.at(-1)?.end ?? end)
      .replace(/ +/g, ' ')
      .trim();
  }

  // The whole text of the block a selection is in; '' when it spans blocks.
  function blockTextOf(range) {
    const block = globalThis.paragloss.inspectBlock(range.startContainer)?.target;
    if (!(block instanceof Element) || !block.contains(range.endContainer)) return '';
    return block.textContent;
  }

  // The words around a selected phrase, from the text of its block.
  function contextOf(range) {
    const block = globalThis.paragloss.inspectBlock(range.startContainer)?.target;
    if (!(block instanceof Element) || !block.contains(range.endContainer)) return '';
    const head = document.createRange();
    head.selectNodeContents(block);
    const text = head.toString();
    head.setEnd(range.startContainer, range.startOffset);
    const start = head.toString().length;
    return wordsAround(text, start, start + range.toString().length);
  }

  Object.assign((globalThis.paragloss ??= {}), { selectionAt, isShortPhrase, wordsAround, blockTextOf, contextOf });
})();
