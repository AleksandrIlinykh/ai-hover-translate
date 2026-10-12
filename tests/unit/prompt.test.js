import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages } from '../../extension/lib/prompt.js';

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
  const [system, user] = buildMessages('bank', 'Russian', 'dictionary');
  assert.match(system.content, /bilingual dictionary/);
  assert.match(system.content, /Reply in Russian/);
  assert.match(system.content, /part of speech/);
  assert.deepEqual(user, { role: 'user', content: 'bank' });
});

test('buildMessages uses the plain translation prompt by default', () => {
  assert.deepEqual(buildMessages('x', 'German'), buildMessages('x', 'German', 'text'));
});
