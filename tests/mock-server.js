import http from 'node:http';
import { readFile } from 'node:fs/promises';

const FIXTURES = new URL('./fixtures/', import.meta.url);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sseData = (content) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`;

// Fake OpenAI-compatible API plus the fixture pages, on a random local port.
// The API key picks the behaviour: bad → 401, broke → 402, empty → no text,
// slow → one chunk per second, split → a four-byte emoji cut between writes,
// flaky → 500 on the first request and normal answers after it,
// anything else → "[RU] <text>" in three chunks.
export async function startMockServer() {
  const requests = [];
  const state = { flakyFailed: false };
  const server = http.createServer((req, res) => {
    handle(req, res, requests, state).catch((error) => {
      console.error(error);
      res.destroy();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

async function handle(req, res, requests, state) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
  } else if (req.method === 'GET' && /^\/[\w-]+\.html$/.test(req.url)) {
    const html = await readFile(new URL(req.url.slice(1), FIXTURES));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
  } else if (req.method === 'POST' && req.url === '/chat/completions') {
    await completions(req, res, requests, state);
  } else {
    res.writeHead(404).end();
  }
}

async function completions(req, res, requests, state) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const record = {
    authorization: req.headers.authorization,
    body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    aborted: false,
  };
  requests.push(record);

  let finished = false;
  res.on('close', () => {
    if (!finished) record.aborted = true;
  });
  const finish = (data) => {
    finished = true;
    res.end(data);
  };

  const key = record.authorization?.replace(/^Bearer /, '');
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
  res.write(': keep-alive\n\n');

  if (key === 'empty') {
    finish('data: [DONE]\n\n');
    return;
  }

  if (key === 'split') {
    const bytes = Buffer.from(sseData('Hello 👋 world'));
    const cut = bytes.indexOf(Buffer.from('👋')) + 2;
    res.write(bytes.subarray(0, cut));
    await delay(50);
    res.write(bytes.subarray(cut));
    finish('data: [DONE]\n\n');
    return;
  }

  const translation = `[RU] ${record.body.messages.at(-1).content}`;
  const size = Math.ceil(translation.length / 3);
  const pause = key === 'slow' ? 1000 : 30;
  for (let i = 0; i < translation.length; i += size) {
    if (i > 0) await delay(pause);
    if (record.aborted) return;
    res.write(sseData(translation.slice(i, i + size)));
  }
  finish('data: [DONE]\n\n');
}
