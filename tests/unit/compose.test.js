import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildComposeMessages, chooseComposeTarget, pickReferences, rememberPair } from '../../extension/lib/compose.js';

// The user writes in German here; the project's files keep to the Latin script.

test('the compose prompt asks for natural work writing from one language into the other', () => {
  const messages = buildComposeMessages('Der Build schlägt fehl', 'German', 'English');
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /^You help a professional write in English at work\./);
  assert.match(messages[0].content, /Translate the user's text from German into English/);
  assert.match(messages[0].content, /Output only the translation/);
  assert.doesNotMatch(messages[0].content, /topic|Earlier/);
  assert.deepEqual(messages[1], { role: 'user', content: 'Der Build schlägt fehl' });
});

test('the compose prompt carries the page topic and the reference translations, the user message only the draft', () => {
  const references = [{ source: 'The build fails on main.', translation: 'Der Build schlägt auf main fehl.' }];
  const [system, user] = buildComposeMessages('Der Build schlägt wieder fehl', 'German', 'English', {
    topics: ['ci', 'devops'],
    references,
  });
  assert.match(system.content, /Topic of the page the user is writing on: ci, devops\./);
  assert.match(system.content, /use the same terms/);
  assert.ok(system.content.includes('English: "The build fails on main."\nGerman: "Der Build schlägt auf main fehl."'));
  assert.equal(user.content, 'Der Build schlägt wieder fehl');
});

const pair = (source, translation, lang = 'en') => ({ source, translation, lang });

test('pickReferences takes the pairs whose translation shares the most words with the draft', () => {
  const pairs = [
    pair('The weather is nice.', 'Das Wetter ist schön.'),
    pair('The build fails on the main branch.', 'Der Build schlägt im Hauptzweig fehl.'),
    pair('Merge the branch after the review.', 'Führen Sie den Zweig nach dem Review zusammen.'),
  ];
  const picked = pickReferences(pairs, 'Der Build schlägt im Zweig fehl, Fix nötig', { to: 'en' });
  assert.deepEqual(
    picked.map((reference) => reference.source),
    ['The build fails on the main branch.', 'Merge the branch after the review.'],
  );
});

test('pickReferences matches words across endings by their first letters, and ignores short words', () => {
  const pairs = [pair('Open the list of branches.', 'Öffne die Liste der Zweige.')];
  assert.equal(pickReferences(pairs, 'die der', { to: 'en' }).length, 0);
  assert.equal(pickReferences(pairs, 'im Zweig', { to: 'en' }).length, 1);
});

test('pickReferences keeps at most `limit` pairs within the character budget, in the target language only', () => {
  const pairs = [
    pair('A'.repeat(1500), 'Build eins'),
    pair('B'.repeat(1500), 'Build zwei'),
    pair('C'.repeat(10), 'Build drei', 'fr'),
    pair('D'.repeat(10), 'Build vier', null),
  ];
  const picked = pickReferences(pairs, 'Build', { to: 'en', limit: 3, budget: 2000 });
  assert.deepEqual(
    picked.map((reference) => reference.source[0]),
    ['D', 'B'],
    'the newest come first among equals; French is skipped; the second long one would break the budget',
  );
});

test('rememberPair keeps the newest pairs, drops repeats and caps the list', () => {
  let pairs = [];
  for (let i = 0; i < 35; i++) pairs = rememberPair(pairs, pair(`Text ${i}`, `Satz ${i}`));
  assert.equal(pairs.length, 30);
  assert.equal(pairs.at(-1).source, 'Text 34');
  pairs = rememberPair(pairs, pair('Text 10', 'Satz 10 wieder'));
  assert.equal(pairs.at(-1).translation, 'Satz 10 wieder');
  assert.equal(pairs.filter((item) => item.source === 'Text 10').length, 1);
});

test('chooseComposeTarget prefers the saved choice, then the language read on the site, the page, the last one', () => {
  const base = { from: 'de', saved: null, readLangs: [], pageLang: null, last: null };
  assert.equal(chooseComposeTarget({ ...base, saved: 'es', readLangs: ['fr'], pageLang: 'en' }), 'es');
  assert.equal(chooseComposeTarget({ ...base, readLangs: ['fr', 'en', 'fr'], pageLang: 'en' }), 'fr');
  assert.equal(chooseComposeTarget({ ...base, pageLang: 'es', last: 'it' }), 'es');
  assert.equal(chooseComposeTarget({ ...base, last: 'it' }), 'it');
  assert.equal(chooseComposeTarget(base), 'en');
});

test("chooseComposeTarget never picks the user's own language or one it does not know", () => {
  assert.equal(chooseComposeTarget({ from: 'de', saved: null, readLangs: ['de'], pageLang: 'de', last: null }), 'en');
  assert.equal(chooseComposeTarget({ from: 'de', saved: 'xx', readLangs: [], pageLang: 'zh-Hant', last: null }), 'en');
  assert.equal(chooseComposeTarget({ from: 'en', saved: null, readLangs: [], pageLang: 'en', last: null }), 'ru');
});
