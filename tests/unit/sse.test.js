import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSseParser, deltaFromPayload } from '../../extension/lib/sse.js';

test('push returns the data payloads of complete lines', () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push('data: {"a":1}\n\ndata: [DONE]\n\n'), ['{"a":1}', '[DONE]']);
});

test('a line split between chunks is returned once it is complete', () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push('data: {"a"'), []);
  assert.deepEqual(parser.push(':1}\n'), ['{"a":1}']);
});

test('CRLF line endings work, even with CR and LF in different chunks', () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push('data: one\r'), []);
  assert.deepEqual(parser.push('\ndata: two\r\n'), ['one', 'two']);
});

test('comments and other fields are ignored', () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push(': keep-alive\nevent: message\nid: 1\ndata: x\n'), ['x']);
});

test('only one space after "data:" is removed', () => {
  assert.deepEqual(createSseParser().push('data:x\ndata:  y\n'), ['x', ' y']);
});

test('flush returns the last line when the stream ends without a newline', () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push('data: [DONE]'), []);
  assert.deepEqual(parser.flush(), ['[DONE]']);
  assert.deepEqual(parser.flush(), []);
});

test('flush drops a trailing CR', () => {
  const parser = createSseParser();
  parser.push('data: [DONE]\r');
  assert.deepEqual(parser.flush(), ['[DONE]']);
});

test('deltaFromPayload recognises the end marker', () => {
  assert.deepEqual(deltaFromPayload('[DONE]'), { done: true });
});

test('deltaFromPayload extracts delta content', () => {
  assert.deepEqual(deltaFromPayload('{"choices":[{"index":0,"delta":{"content":"Hello"}}]}'), { text: 'Hello' });
});

test('deltaFromPayload returns null for payloads without text', () => {
  assert.equal(deltaFromPayload('{"choices":[{"delta":{"role":"assistant"}}]}'), null);
  assert.equal(deltaFromPayload('{"choices":[{"delta":{"content":""}}]}'), null);
  assert.equal(deltaFromPayload('{"choices":[{"delta":{"content":null}}]}'), null);
  assert.equal(deltaFromPayload('{"choices":[]}'), null);
  assert.equal(deltaFromPayload('{'), null);
});

test('deltaFromPayload skips reasoning deltas', () => {
  assert.equal(deltaFromPayload('{"choices":[{"delta":{"reasoning_content":"Hmm"}}]}'), null);
  assert.equal(deltaFromPayload('{"choices":[{"delta":{"reasoning":"Hmm","content":""}}]}'), null);
});

test('deltaFromPayload joins the text parts of content given as a list', () => {
  const payload = JSON.stringify({ choices: [{ delta: { content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'Hi' }] } }] });
  assert.deepEqual(deltaFromPayload(payload), { text: 'Hi' });
});

test('deltaFromPayload reads Anthropic text deltas and the end of the message', () => {
  const delta = (inner) => JSON.stringify({ type: 'content_block_delta', index: 0, delta: inner });
  assert.deepEqual(deltaFromPayload(delta({ type: 'text_delta', text: 'Hello' })), { text: 'Hello' });
  assert.equal(deltaFromPayload(delta({ type: 'thinking_delta', thinking: 'Hmm' })), null);
  assert.equal(deltaFromPayload('{"type":"ping"}'), null);
  assert.equal(deltaFromPayload('{"type":"message_start","message":{}}'), null);
  assert.deepEqual(deltaFromPayload('{"type":"message_stop"}'), { done: true });
});
