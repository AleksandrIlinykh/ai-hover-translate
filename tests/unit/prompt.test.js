import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages } from '../../extension/lib/prompt.js';
import { notesBlock } from '../../extension/lib/notes.js';

test('buildMessages puts the language into the system prompt and the text into the user message', () => {
  const messages = buildMessages('Hello,\nworld', 'German');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /Translate the user's text into German\./);
  assert.match(messages[0].content, /If the text is already in German, return it unchanged\./);
  assert.deepEqual(messages[1], { role: 'user', content: 'Hello,\nworld' });
});

test('buildMessages asks for the translation only and keeps line breaks', () => {
  const [system] = buildMessages('x', 'Russian');
  assert.match(system.content, /Output only the translation/);
  assert.match(system.content, /line breaks/);
});

test('buildMessages in dictionary mode asks for a short dictionary entry', () => {
  const [system, user] = buildMessages('bank', 'Russian', { mode: 'dictionary' });
  assert.match(system.content, /bilingual dictionary/);
  assert.match(system.content, /Reply in Russian/);
  assert.match(system.content, /the most common translation/);
  assert.match(system.content, /part of speech/);
  assert.doesNotMatch(system.content, /Context/);
  assert.deepEqual(user, { role: 'user', content: 'bank' });
});

test('buildMessages uses the plain translation prompt by default', () => {
  assert.deepEqual(buildMessages('x', 'German'), buildMessages('x', 'German', { mode: 'text' }));
});

test('buildMessages asks a dictionary for the sense that fits the words around the phrase', () => {
  const [system, user] = buildMessages('bank', 'Russian', { mode: 'dictionary', context: 'we sat on the river bank and watched' });
  assert.match(system.content, /the translation that fits the context below/);
  assert.doesNotMatch(system.content, /the most common translation/);
  assert.ok(system.content.endsWith('\nContext: "we sat on the river bank and watched"'));
  assert.deepEqual(user, { role: 'user', content: 'bank' });
});

test('buildMessages ignores the context of a plain translation', () => {
  assert.deepEqual(buildMessages('x', 'German', { context: 'a b x c d' }), buildMessages('x', 'German'));
});

test('buildMessages adds the site notes after the instructions and before the context', () => {
  const block = notesBlock('A site about CI.', 'the site this text is from');
  const [plain] = buildMessages('x', 'German', { notes: 'A site about CI.' });
  assert.ok(plain.content.endsWith(`\n${block}`));
  const [dictionary] = buildMessages('pipeline', 'German', { mode: 'dictionary', context: 'the build pipeline failed', notes: 'A site about CI.' });
  assert.ok(dictionary.content.endsWith(`\n${block}\nContext: "the build pipeline failed"`));
});

test('buildMessages adds no notes without them, and never a topic line', () => {
  const [system] = buildMessages('x', 'German', { notes: '' });
  assert.doesNotMatch(system.content, /Notes on|<notes>|topic/i);
});
