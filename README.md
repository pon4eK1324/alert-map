# AlertMap

Карта повітряних тривог України з таймлапсом. Сервер (Node.js) збирає тривоги з alerts.in.ua / siren.pp.ua / ubilling
та повідомлення про цілі з публічних Telegram-каналів (`t.me/s/...`), клієнт — Leaflet. Є обгортка Electron для Windows `.exe`.

## Запуск
- Сайт: `run-site.bat` або `npm install && npm start` → http://localhost:3000
- Тести парсера: `npm test`
- Windows `.exe` (portable): `build-exe.bat`

## Налаштування
Скопіюйте `config.example.json` у `config.json` (не додавайте його в git):
`{ "alertsToken": "...", "channels": ["kpszsu", "..."], "pollSeconds": 30 }`.
Список каналів можна міняти й в інтерфейсі (⚙ Вигляд) — лише з того ж комп'ютера, де запущено сервер.
Канали без публічного перегляду автоматично позначаються «недоступним» і опитуються раз на 6 годин.

## Дані
`data/` (історія для таймлапсу й `log.txt`) створюється автоматично; у git не потрапляє.
Межі районів: korzhyk/alert-map (MIT), див. `public/LICENSE-korzhyk-alert-map.txt`.
