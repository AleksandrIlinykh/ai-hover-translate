import http from 'node:http';
import { readFile } from 'node:fs/promises';

const FIXTURES = new URL('./fixtures/', import.meta.url);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TOPICS = 'Git, Continuous Integration, DevOps';
const MODELS = ['mock-small', 'mock-large', 'text-embedding-mock', 'models/mock-gemini'];
const REASONING_SWITCHES = ['thinking', 'reasoning_effort', 'reasoning', 'enable_thinking'];
const RECORDED_HEADERS = [
  'x-api-key',
  'anthropic-version',
  'anthropic-dangerous-direct-browser-access',
  'origin',
  'http-referer',
  'x-title',
];

// One streamed piece of text, as OpenAI-compatible APIs and Anthropic send it.
const SSE = {
  openai: (content) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`,
  anthropic: (text) =>
    `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}\n\n`,
};
const STREAM_END = { openai: 'data: [DONE]\n\n', anthropic: 'event: message_stop\ndata: {"type":"message_stop"}\n\n' };

// Fake OpenAI-compatible API (POST /chat/completions, GET /models), fake Anthropic Messages API (POST /messages)
// and the fixture pages, on a random local port.
// The API key picks the behaviour: bad → 401, broke → 402, empty → no text,
// slow → one chunk per second, split → a four-byte emoji cut between writes,
// flaky → 500 on the first request and normal answers after it,
// strict → 400 for a request that carries a reasoning switch,
// anything else → "[RU] <text>" in three chunks.
// Requests that are not streamed ask for the page topic: bad → 401, anything else → three tags.
// They are recorded in `topicRequests`, apart from the translations in `requests`.
export async function startMockServer() {
  const requests = [];
  const topicRequests = [];
  const state = { flakyFailed: false };
  const server = http.createServer((req, res) => {
    handle(req, res, { requests, topicRequests }, state).catch((error) => {
      console.error(error);
      res.destroy();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    topicRequests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

async function handle(req, res, records, state) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
  } else if (req.method === 'GET' && /^\/[\w-]+\.html$/.test(req.url)) {
    const html = await readFile(new URL(req.url.slice(1), FIXTURES));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
  } else if (req.method === 'GET' && req.url === '/models') {
    listModels(req, res);
  } else if (req.method === 'POST' && req.url === '/chat/completions') {
    await completions(req, res, records, state, 'openai');
  } else if (req.method === 'POST' && req.url === '/messages') {
    await completions(req, res, records, state, 'anthropic');
  } else {
    res.writeHead(404).end();
  }
}

const keyOf = (req) => req.headers['x-api-key'] ?? req.headers.authorization?.replace(/^Bearer /, '');

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function listModels(req, res) {
  if (keyOf(req) === 'bad') {
    json(res, 401, { error: { message: 'Authentication Fails' } });
    return;
  }
  json(res, 200, { object: 'list', data: MODELS.map((id) => ({ id, object: 'model' })) });
}

async function completions(req, res, { requests, topicRequests }, state, api) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const record = {
    path: req.url,
    authorization: req.headers.authorization,
    headers: Object.fromEntries(RECORDED_HEADERS.map((name) => [name, req.headers[name]])),
    body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    aborted: false,
  };
  const key = keyOf(req);
  (record.body.stream === true ? requests : topicRequests).push(record);

  if (key === 'strict' && REASONING_SWITCHES.some((name) => name in record.body)) {
    const name = REASONING_SWITCHES.find((switchName) => switchName in record.body);
    json(res, 400, { error: { message: `Unsupported parameter: '${name}'` } });
    return;
  }
  if (record.body.stream !== true) {
    answerTopics(res, key, api);
    return;
  }

  let finished = false;
  res.on('close', () => {
    if (!finished) record.aborted = true;
  });
  const finish = (data) => {
    finished = true;
    res.end(data);
  };

  if (key === 'flaky' && !state.flakyFailed) {
    state.flakyFailed = true;
    res.writeHead(500, { 'Content-Type': 'application/json' });
    finish(JSON.stringify({ error: { message: 'Internal error', type: 'api_error' } }));
    return;
  }

  if (key === 'bad' || key === 'broke') {
    const [status, message] = key === 'bad' ? [401, 'Authentication Fails'] : [402, 'Insufficient Balance'];
    res.writeHead(status, { 'Content-Type': 'application/json' });
    finish(JSON.stringify({ error: { message, type: 'invalid_request_error' } }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.write(api === 'anthropic' ? 'event: ping\ndata: {"type":"ping"}\n\n' : ': keep-alive\n\n');

  if (key === 'empty') {
    finish(STREAM_END[api]);
    return;
  }

  if (key === 'split') {
    const bytes = Buffer.from(SSE[api]('Hello 👋 world'));
    const cut = bytes.indexOf(Buffer.from('👋')) + 2;
    res.write(bytes.subarray(0, cut));
    await delay(50);
    res.write(bytes.subarray(cut));
    finish(STREAM_END[api]);
    return;
  }

  const translation = `[RU] ${record.body.messages.at(-1).content}`;
  const size = Math.ceil(translation.length / 3);
  const pause = key === 'slow' ? 1000 : 30;
  for (let i = 0; i < translation.length; i += size) {
    if (i > 0) await delay(pause);
    if (record.aborted) return;
    res.write(SSE[api](translation.slice(i, i + size)));
  }
  finish(STREAM_END[api]);
}

function answerTopics(res, key, api) {
  if (key === 'bad') {
    json(res, 401, { error: { message: 'Authentication Fails', type: 'invalid_request_error' } });
    return;
  }
  if (api === 'anthropic') {
    json(res, 200, { type: 'message', role: 'assistant', content: [{ type: 'text', text: TOPICS }] });
    return;
  }
  const message = { role: 'assistant', content: TOPICS };
  json(res, 200, { choices: [{ index: 0, message, finish_reason: 'stop' }] });
}
