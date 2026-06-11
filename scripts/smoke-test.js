/**
 * Локальная проверка relay без реального Telegram (mock API).
 * Запуск: node scripts/smoke-test.js
 */
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const API_SECRET = 'smoke-test-secret';
const RELAY_PORT = 13080;
const MOCK_TELEGRAM_PORT = 13081;

function request(method, port, urlPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers,
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function startMockTelegram() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url.includes('/sendMessage')) {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
          const payload = JSON.parse(raw);
          if (payload.text && Buffer.byteLength(payload.text, 'utf8') > 0) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, result: { message_id: 1 } }));
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, description: 'bad text' }));
          }
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(MOCK_TELEGRAM_PORT, '127.0.0.1', () => resolve(server));
  });
}

function startRelay() {
  return spawn('node', [path.join(__dirname, '..', 'src', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(RELAY_PORT),
      API_SECRET,
      TELEGRAM_API_BASE: `http://127.0.0.1:${MOCK_TELEGRAM_PORT}/bot`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function run() {
  const mockServer = await startMockTelegram();
  const relay = startRelay();

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('relay startup timeout')), 5000);
    relay.stdout.on('data', (buf) => {
      if (buf.toString().includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    relay.stderr.on('data', (buf) => process.stderr.write(buf));
    relay.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`relay exited with code ${code}`));
    });
  });

  const cases = [];

  const health = await request('GET', RELAY_PORT, '/health');
  cases.push({ name: 'GET /health', pass: health.status === 200 && health.body.ok === true });

  const unauthorized = await request('POST', RELAY_PORT, '/send', {
    'Content-Type': 'application/json',
  }, JSON.stringify({ bot_token: 'x', chat_id: '1', text: 'hi' }));
  cases.push({ name: 'POST /send without auth → 401', pass: unauthorized.status === 401 });

  const badBody = await request('POST', RELAY_PORT, '/send', {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${API_SECRET}`,
  }, JSON.stringify({ bot_token: 'tok' }));
  cases.push({ name: 'POST /send missing fields → 400', pass: badBody.status === 400 });

  const utf8Body = JSON.stringify({
    bot_token: '123:test',
    chat_id: '-100',
    text: 'Тест UTF-8 связи',
  });
  const success = await request('POST', RELAY_PORT, '/send', {
    'Content-Type': 'application/json; charset=utf-8',
    Authorization: `Bearer ${API_SECRET}`,
    'Content-Length': Buffer.byteLength(utf8Body),
  }, utf8Body);
  cases.push({
    name: 'POST /send UTF-8 via mock Telegram → 200',
    pass: success.status === 200 && success.body.ok === true,
  });

  const numericChatId = JSON.stringify({
    bot_token: '123:test',
    chat_id: -5227692160,
    text: 'numeric chat_id',
  });
  const numeric = await request('POST', RELAY_PORT, '/send', {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${API_SECRET}`,
    'Content-Length': Buffer.byteLength(numericChatId),
  }, numericChatId);
  cases.push({
    name: 'POST /send numeric chat_id → 200',
    pass: numeric.status === 200 && numeric.body.ok === true,
  });

  relay.kill();
  mockServer.close();

  let failed = 0;
  for (const c of cases) {
    const mark = c.pass ? 'OK' : 'FAIL';
    console.log(`[${mark}] ${c.name}`);
    if (!c.pass) failed += 1;
  }

  if (failed > 0) {
    process.exit(1);
  }
  console.log(`\nAll ${cases.length} checks passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
