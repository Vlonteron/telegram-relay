# Telegram Relay

HTTP-прокладка для отправки сообщений в Telegram Bot API. Нужна, если основной сервер не может достучаться до `api.telegram.org` (блокировка исходящего трафика).

## Запуск

```bash
cp .env.example .env
# отредактируйте API_SECRET

docker compose up -d --build
```

## API

### `GET /health`

Проверка, что сервис жив.

### `POST /send`

Заголовок авторизации (один из):

- `Authorization: Bearer <API_SECRET>`
- `X-Api-Key: <API_SECRET>`

Тело (JSON, UTF-8):

```json
{
  "bot_token": "123456:ABC...",
  "chat_id": "-5227692160",
  "text": "Тест связи"
}
```

Ответ при успехе: `{"ok":true,"result":{...}}`

## Тест с другого сервера

```bash
curl -s -X POST "http://RELAY_HOST:3080/send" \
  -H "Authorization: Bearer YOUR_API_SECRET" \
  -H "Content-Type: application/json; charset=utf-8" \
  --data-binary '{"bot_token":"...","chat_id":"-5227692160","text":"Test"}'
```

## Интеграция с printing-api

В `.env` основного API:

```env
SWITCH_TELEGRAM_ENABLED=true
SWITCH_TELEGRAM_BOT_TOKEN=...
SWITCH_TELEGRAM_CHAT_ID=-5227692160
SWITCH_TELEGRAM_RELAY_URL=http://RELAY_HOST:3080/send
SWITCH_TELEGRAM_RELAY_SECRET=YOUR_API_SECRET
```

## Безопасность

- Ограничьте доступ к порту relay файрволом (только IP основного сервера).
- Используйте длинный случайный `API_SECRET`.
- Не публикуйте relay в интернет без ограничения по IP.
