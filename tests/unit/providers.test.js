import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PROVIDERS,
  answerText,
  chatRequest,
  hostPattern,
  modelsRequest,
  parseModels,
  setupProblem,
} from '../../extension/lib/providers.js';

const manifest = JSON.parse(readFileSync(new URL('../../extension/manifest.json', import.meta.url), 'utf8'));
const messages = [
  { role: 'system', content: 'Translate.' },
  { role: 'user', content: 'Hello' },
];
const bodyOf = (request) => JSON.parse(request.init.body);

// A provider as activeProvider() returns it, with a key, a model and a URL.
function provider(id, fields = {}) {
  const preset = PROVIDERS[id];
  return { id, ...preset, apiKey: 'sk', model: preset.model || 'm', baseUrl: preset.baseUrl || 'https://llm.example/v1', ...fields };
}

// Whether a manifest match pattern such as https://*.example.com/* covers the origin of `url`.
function covers(pattern, url) {
  const [, scheme, host] = pattern.match(/^(\w+):\/\/([^/]+)\//);
  const { protocol, hostname } = new URL(url);
  if (`${scheme}:` !== protocol) return false;
  return host.startsWith('*.') ? hostname.endsWith(host.slice(1)) : hostname === host;
}

test('the free built-in translator, the main cloud APIs, two local servers and any OpenAI-compatible API are offered', () => {
  assert.deepEqual(Object.keys(PROVIDERS), [
    'chrome',
    'deepseek',
    'openai',
    'anthropic',
    'gemini',
    'openrouter',
    'groq',
    'mistral',
    'xai',
    'qwen',
    'ollama',
    'lmstudio',
    'custom',
  ]);
  for (const [id, preset] of Object.entries(PROVIDERS)) {
    assert.ok(preset.name, id);
    assert.ok(['browser', 'openai', 'anthropic'].includes(preset.api), id);
    assert.ok(['free', 'cloud', 'local', 'other'].includes(preset.group), id);
    assert.equal(preset.keyRequired, preset.group === 'cloud', id);
    if (preset.keyRequired) assert.match(preset.keyUrl, /^https:\/\//, id);
  }
});

test('the manifest lets the extension reach every preset API', () => {
  for (const [id, preset] of Object.entries(PROVIDERS)) {
    if (!preset.baseUrl) continue;
    assert.ok(manifest.host_permissions.some((pattern) => covers(pattern, preset.baseUrl)), id);
  }
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*', 'http://*/*']);
});

test('a DeepSeek translation streams with temperature 1.3 and thinking off', () => {
  const request = chatRequest(provider('deepseek'), { messages, stream: true });
  assert.equal(request.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers.Authorization, 'Bearer sk');
  assert.deepEqual(bodyOf(request), {
    model: 'deepseek-flash',
    messages,
    stream: true,
    temperature: 1.3,
    thinking: { type: 'disabled' },
  });
});

test('a topic request is small, and DeepSeek answers it at temperature 0', () => {
  const body = bodyOf(chatRequest(provider('deepseek'), { messages, stream: false, purpose: 'topics' }));
  assert.equal(body.stream, false);
  assert.equal(body.max_tokens, 200);
  assert.equal(body.temperature, 0);
});

test('OpenAI gets reasoning off, max_completion_tokens and no temperature', () => {
  const body = bodyOf(chatRequest(provider('openai'), { messages, stream: false, purpose: 'topics' }));
  assert.equal(body.reasoning_effort, 'none');
  assert.equal(body.max_completion_tokens, 200);
  assert.equal(body.max_tokens, undefined);
  assert.equal(body.temperature, undefined);
});

test('each provider turns reasoning off its own way', () => {
  const extras = (id) => {
    const { model, messages: _, stream, ...rest } = bodyOf(chatRequest(provider(id), { messages, stream: true }));
    return rest;
  };
  assert.deepEqual(extras('gemini'), { reasoning_effort: 'minimal' });
  assert.deepEqual(extras('openrouter'), { reasoning: { effort: 'none' } });
  assert.deepEqual(extras('groq'), { reasoning_effort: 'low' });
  assert.deepEqual(extras('mistral'), { reasoning_effort: 'none' });
  assert.deepEqual(extras('qwen'), { enable_thinking: false });
  assert.deepEqual(extras('ollama'), { reasoning_effort: 'none' });
  assert.deepEqual(extras('xai'), {});
  assert.deepEqual(extras('custom'), {});
});

test('without extras the reasoning switch is left out, the rest stays', () => {
  const body = bodyOf(chatRequest(provider('deepseek'), { messages, stream: true }, { extras: false }));
  assert.equal(body.thinking, undefined);
  assert.equal(body.temperature, 1.3);
});

test('Anthropic gets its Messages API: key header, system apart, max_tokens, thinking off', () => {
  const request = chatRequest(provider('anthropic'), { messages, stream: true });
  assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(request.init.headers['x-api-key'], 'sk');
  assert.equal(request.init.headers['anthropic-version'], '2023-06-01');
  assert.equal(request.init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(request.init.headers.Authorization, undefined);
  assert.deepEqual(bodyOf(request), {
    model: 'claude-haiku-5-5',
    system: 'Translate.',
    messages: [{ role: 'user', content: 'Hello' }],
    max_tokens: 8192,
    stream: true,
    thinking: { type: 'disabled' },
  });
  const topics = bodyOf(chatRequest(provider('anthropic'), { messages, stream: false, purpose: 'topics' }));
  assert.equal(topics.max_tokens, 200);
});

test('a local server without a key gets no Authorization header', () => {
  const request = chatRequest(provider('ollama', { apiKey: '' }), { messages, stream: true });
  assert.equal(request.url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(request.init.headers.Authorization, undefined);
});

test('OpenRouter is told which app is calling', () => {
  const { headers } = chatRequest(provider('openrouter'), { messages, stream: true }).init;
  assert.equal(headers['HTTP-Referer'], 'https://github.com/AleksandrIlinykh/ai-hover-translate');
  assert.equal(headers['X-Title'], 'Paragloss');
});

test('the model list is asked with the same key headers', () => {
  const openai = modelsRequest(provider('openai'));
  assert.equal(openai.url, 'https://api.openai.com/v1/models');
  assert.equal(openai.init.method, 'GET');
  assert.equal(openai.init.headers.Authorization, 'Bearer sk');
  const anthropic = modelsRequest(provider('anthropic'));
  assert.equal(anthropic.url, 'https://api.anthropic.com/v1/models');
  assert.equal(anthropic.init.headers['x-api-key'], 'sk');
});

test('parseModels keeps sorted unique chat models and drops prefixes and other kinds', () => {
  const data = {
    data: [
      { id: 'b-chat' },
      { id: 'models/a-chat' },
      { id: 'text-embedding-3-small' },
      { id: 'whisper-1' },
      { id: 'tts-1' },
      { id: 'b-chat' },
      { name: 'no id' },
    ],
  };
  assert.deepEqual(parseModels(data), ['a-chat', 'b-chat']);
  assert.deepEqual(parseModels(null), []);
  assert.deepEqual(parseModels({ data: 'x' }), []);
});

test('answerText reads OpenAI and Anthropic answers', () => {
  assert.equal(answerText({ choices: [{ message: { content: 'a, b' } }] }), 'a, b');
  assert.equal(answerText({ choices: [{ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: ', b' }] } }] }), 'a, b');
  assert.equal(answerText({ content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'a, b' }] }), 'a, b');
  assert.equal(answerText({}), '');
  assert.equal(answerText(null), '');
});

test('setupProblem names what is missing before anything is sent', () => {
  assert.equal(setupProblem(provider('deepseek', { apiKey: '' })), 'no_key');
  assert.equal(setupProblem(provider('ollama', { apiKey: '', model: 'llama3' })), null);
  assert.equal(setupProblem(provider('openrouter', { model: '' })), 'no_model');
  assert.equal(setupProblem(provider('custom', { baseUrl: '' })), 'no_url');
  assert.equal(setupProblem(provider('custom', { baseUrl: 'not a url' })), 'no_url');
  assert.equal(setupProblem(provider('openai')), null);
  assert.equal(setupProblem({ id: 'chrome', ...PROVIDERS.chrome, apiKey: '', model: '', baseUrl: '' }), null);
});

test('hostPattern turns an API URL into the host permission it needs', () => {
  assert.equal(hostPattern('https://llm.example.com/v1'), 'https://llm.example.com/*');
  assert.equal(hostPattern('http://10.0.0.5:8080/v1'), 'http://10.0.0.5:8080/*');
  assert.equal(hostPattern('ftp://files.example.com'), null);
  assert.equal(hostPattern('nonsense'), null);
});
