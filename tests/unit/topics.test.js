import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTopicMessages, cleanTopics, parseTopics } from '../../extension/lib/topics.js';

test('buildTopicMessages asks for a few short English tags of the text', () => {
  const [system, user] = buildTopicMessages('The build pipeline failed.');
  assert.equal(system.role, 'system');
  assert.match(system.content, /3 to 5 short tags/);
  assert.match(system.content, /in English, lowercase, separated by commas/);
  assert.deepEqual(user, { role: 'user', content: 'The build pipeline failed.' });
});

test('buildTopicMessages sends at most the first 1500 characters', () => {
  const [, user] = buildTopicMessages('a'.repeat(1499) + 'bc');
  assert.equal(user.content, 'a'.repeat(1499) + 'b');
});

test('parseTopics splits a reply on commas and line breaks and tidies each tag', () => {
  assert.deepEqual(parseTopics('Git, "Continuous Integration",\n#DevOps.\n- ci'), ['git', 'continuous integration', 'devops', 'ci']);
});

test('parseTopics drops empty, duplicate and overlong tags and keeps at most five', () => {
  assert.deepEqual(parseTopics('a, , A, b, c, d, e, f'), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(parseTopics(`${'x'.repeat(31)}, ok`), ['ok']);
});

test('parseTopics returns no tags for a missing reply', () => {
  assert.deepEqual(parseTopics(undefined), []);
  assert.deepEqual(parseTopics(''), []);
});

test('cleanTopics accepts only a list of strings', () => {
  assert.deepEqual(cleanTopics([' Git ', 42, 'ci']), ['git', 'ci']);
  assert.deepEqual(cleanTopics('git, ci'), []);
  assert.deepEqual(cleanTopics(undefined), []);
});
