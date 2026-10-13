import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorFromStatus, makeError } from '../../extension/lib/errors.js';

const DEEPSEEK = { name: 'DeepSeek' };
const OPENROUTER = { name: 'OpenRouter' };

const STATUS_CASES = [
  [401, '{"error":{"message":"Authentication Fails"}}', 'auth', 'Invalid API key. Check it in the settings.'],
  [402, '', 'balance', 'Your DeepSeek balance has run out.'],
  [403, '{"error":{"message":"Region not supported"}}', 'denied', 'Access denied (403): Region not supported'],
  [404, '{"error":{"message":"Model not found"}}', 'not_found', 'Not found (404). Check the model and the API URL: Model not found'],
  [404, '', 'not_found', 'Not found (404). Check the model and the API URL'],
  [429, '', 'rate_limit', 'Too many requests. Please wait a moment.'],
  [400, '{"error":{"message":"Invalid model"}}', 'bad_request', 'Invalid API request: Invalid model'],
  [422, '{"error":{"message":"Bad params"}}', 'bad_request', 'Invalid API request: Bad params'],
  [400, '', 'bad_request', 'Invalid API request'],
  [500, '', 'server', 'The API server is unavailable (500). Try again later.'],
  [502, '', 'server', 'The API server is unavailable (502). Try again later.'],
  [503, '<html>busy</html>', 'server', 'The API server is unavailable (503). Try again later.'],
  [504, '', 'server', 'The API server is unavailable (504). Try again later.'],
  [529, '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', 'server', 'The API server is unavailable (529). Try again later.'],
  [418, 'not json', 'http', 'API error 418'],
  [410, '{"error":{"message":"   "}}', 'http', 'API error 410'],
];

for (const [status, body, code, message] of STATUS_CASES) {
  test(`errorFromStatus ${status} ${JSON.stringify(body)}`, () => {
    assert.deepEqual(errorFromStatus(status, body, DEEPSEEK), { code, message });
  });
}

test('errorFromStatus reads the error formats of other APIs', () => {
  const tail = (body) => errorFromStatus(400, body, DEEPSEEK).message;
  assert.equal(tail('{"error":"model \\"x\\" not found"}'), 'Invalid API request: model "x" not found');
  assert.equal(tail('[{"error":{"code":400,"message":"API key not valid"}}]'), 'Invalid API request: API key not valid');
  assert.equal(tail('{"message":"Bad input"}'), 'Invalid API request: Bad input');
});

test('makeError names the provider where it matters', () => {
  assert.deepEqual(makeError('no_key', DEEPSEEK), { code: 'no_key', message: 'DeepSeek API key is not set.' });
  assert.deepEqual(makeError('no_model', OPENROUTER), {
    code: 'no_model',
    message: 'Choose a model for OpenRouter in the settings.',
  });
  assert.deepEqual(makeError('no_url', OPENROUTER), {
    code: 'no_url',
    message: 'Set the API URL for OpenRouter in the settings.',
  });
  assert.equal(errorFromStatus(402, '', OPENROUTER).message, 'Your OpenRouter balance has run out.');
});

test('makeError returns the fixed texts', () => {
  assert.deepEqual(makeError('network', DEEPSEEK), { code: 'network', message: 'Cannot connect to the API.' });
  assert.deepEqual(makeError('timeout', DEEPSEEK), { code: 'timeout', message: 'The API did not respond within 30 seconds.' });
  assert.deepEqual(makeError('empty', DEEPSEEK), { code: 'empty', message: 'The API returned an empty response.' });
});
