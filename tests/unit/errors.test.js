import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorFromStatus, makeError } from '../../extension/lib/errors.js';

const STATUS_CASES = [
  [401, '{"error":{"message":"Authentication Fails"}}', 'auth', 'Invalid API key. Check it in the settings.'],
  [402, '', 'balance', 'Your DeepSeek balance has run out.'],
  [429, '', 'rate_limit', 'Too many requests. Please wait a moment.'],
  [400, '{"error":{"message":"Invalid model"}}', 'bad_request', 'Invalid API request: Invalid model'],
  [422, '{"error":{"message":"Bad params"}}', 'bad_request', 'Invalid API request: Bad params'],
  [400, '', 'bad_request', 'Invalid API request'],
  [500, '', 'server', 'The API server is unavailable (500). Try again later.'],
  [503, '<html>busy</html>', 'server', 'The API server is unavailable (503). Try again later.'],
  [404, '{"error":{"message":"Not Found"}}', 'http', 'API error 404: Not Found'],
  [418, 'not json', 'http', 'API error 418'],
  [404, '{"error":{"message":"   "}}', 'http', 'API error 404'],
];

for (const [status, body, code, message] of STATUS_CASES) {
  test(`errorFromStatus ${status} ${JSON.stringify(body)}`, () => {
    assert.deepEqual(errorFromStatus(status, body), { code, message });
  });
}

test('makeError returns the fixed texts', () => {
  assert.deepEqual(makeError('no_key'), { code: 'no_key', message: 'DeepSeek API key is not set.' });
  assert.deepEqual(makeError('network'), { code: 'network', message: 'Cannot connect to the API.' });
  assert.deepEqual(makeError('timeout'), { code: 'timeout', message: 'The API did not respond within 30 seconds.' });
  assert.deepEqual(makeError('empty'), { code: 'empty', message: 'The API returned an empty response.' });
});
