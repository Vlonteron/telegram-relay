const express = require('express');

const PORT = parseInt(process.env.PORT || '3080', 10);
const API_SECRET = process.env.API_SECRET || '';
const TELEGRAM_API_BASE = (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org/bot').replace(/\/$/, '');
const MAX_MESSAGE_LENGTH = 4000;
const REQUEST_TIMEOUT_MS = 15000;

const app = express();
app.use(express.json({ limit: '32kb' }));

function truncate(text) {
  if (text.length <= MAX_MESSAGE_LENGTH) {
    return text;
  }
  return text.slice(0, MAX_MESSAGE_LENGTH - 20) + '\n...[обрезано]';
}

function isAuthorized(req) {
  if (!API_SECRET) {
    return false;
  }
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.get('x-api-key');
  return token === API_SECRET;
}

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'telegram-relay' });
});

app.post('/send', async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const botToken = typeof req.body.bot_token === 'string' ? req.body.bot_token.trim() : '';
  const chatId = req.body.chat_id;
  const text = typeof req.body.text === 'string' ? req.body.text : '';
  const hasChatId = chatId !== undefined && chatId !== null && String(chatId).trim() !== '';

  if (!botToken || !hasChatId) {
    return res.status(400).json({
      ok: false,
      error: 'bot_token, chat_id and text are required',
    });
  }

  if (!text) {
    return res.status(400).json({ ok: false, error: 'text is required' });
  }

  const url = `${TELEGRAM_API_BASE}${botToken}/sendMessage`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        chat_id: chatId,
        text: truncate(text),
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });

    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      return res.status(502).json({
        ok: false,
        error: 'Telegram API error',
        telegram: payload,
      });
    }

    return res.json({ ok: true, result: payload.result });
  } catch (err) {
    const message = err.name === 'AbortError' ? 'Telegram request timeout' : err.message;
    return res.status(502).json({ ok: false, error: message });
  } finally {
    clearTimeout(timeout);
  }
});

if (!API_SECRET) {
  console.error('FATAL: API_SECRET is not set');
  process.exit(1);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`telegram-relay listening on :${PORT}`);
});
