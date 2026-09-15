# Развёртывание Stultus у клиента

Проверено на нашей виртуалке (Ubuntu 24.04, Node 24, SketchUp 2024 на
рабочих местах). Два шага: сервер (gateway) и плагин на рабочих машинах.

## 1. Сервер (одна виртуалка или ПК в сети бюро)

Нужно: Linux с Node ≥ 22 (`node -v`), доступ в интернет к api.anthropic.com
и chatgpt.com/openai.com (напрямую или через локальный прокси), открытый
порт 8790 внутри сети бюро.

```bash
sudo mkdir -p /opt/stultus/data && sudo chown $USER:$USER /opt/stultus
cd /opt/stultus && git clone https://github.com/B-A-community/stultus.git app
cd app/server && npm ci && npm run build
cp deploy/.env.example /opt/stultus/.env && chmod 600 /opt/stultus/.env
```

Заполнить `/opt/stultus/.env`:

- `PLUGIN_TOKEN` — длинная случайная строка, её же вводят сотрудники в
  настройках плагина: `head -c 24 /dev/urandom | base64 | tr -d '/+='`.
- `RECIPES_PATH=/opt/stultus/data/recipes.json`.
- Если интернет через прокси: `HTTPS_PROXY`, `HTTP_PROXY`,
  `NODE_USE_ENV_PROXY=1`, `NO_PROXY=localhost,127.0.0.1,192.168.0.0/16`
  (без `NODE_USE_ENV_PROXY` процессы моделей молча висят).
- Пределы можно оставить: `TURN_TOKEN_BUDGET=400000`,
  `TURN_MAX_TOOL_CALLS=60`.

Вход к моделям (от того пользователя, который будет запускать сервис):

- **Codex** (основной): `./node_modules/.bin/codex login --device-auth` в
  `/opt/stultus/app/server` → открыть ссылку, ввести код в течение
  15 минут. Файл `~/.codex/auth.json` появляется после успеха. Тот же вход
  используется генерацией картинок: `RENDER_ENABLED=1` в `.env`.
  Альтернатива — `CODEX_API_KEY`, но тогда постпродакшн не работает.
- **Claude**: `claude login` на сервере (нужен установленный `claude`) и
  `CLAUDE_ASSUME_LOGGED_IN=1` в `.env`, либо `CLAUDE_CODE_OAUTH_TOKEN`
  (печатает `claude setup-token` на залогиненной машине), либо
  `ANTHROPIC_API_KEY`.

Сервис systemd (`/etc/systemd/system/stultus-gateway.service`, подставить
имя пользователя):

```ini
[Unit]
Description=Stultus gateway (SketchUp AI chat)
After=network-online.target
Wants=network-online.target

[Service]
User=USERNAME
WorkingDirectory=/opt/stultus/app/server
EnvironmentFile=/opt/stultus/.env
Environment=HOME=/home/USERNAME
Environment=NODE_ENV=production
Environment=LANG=C.UTF-8
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now stultus-gateway
curl http://localhost:8790/health
```

В ответе `providers` должны быть `configured: true` у нужных провайдеров,
`image_generation.configured: true`, если включён постпродакшн. Журнал:
`journalctl -u stultus-gateway -f -o cat`.

Обновление сервера:

```bash
cd /opt/stultus/app && git pull && cd server && npm ci && npm run build && sudo systemctl restart stultus-gateway
```

Docker-вариант (`server/deploy/docker-compose.yml`) есть, но в бою не
проверялся: используйте systemd.

## 2. Плагин на рабочих машинах

1. Собрать пакет на любой Windows-машине с репозиторием:
   `powershell -ExecutionPolicy Bypass -File tools\build_rbz.ps1` →
   `build\Stultus-<версия>.rbz`. Или взять готовый у того, кто собирал.
2. SketchUp 2024 → Extension Manager → Install Extension → выбрать `.rbz`.
3. Extensions → Stultus — чат с ИИ → шестерёнка → адрес
   `ws://<адрес сервера>:8790/ws` и пропуск из `PLUGIN_TOKEN` → «Сохранить
   и подключиться». В шапке должно стать «gateway <версия>» с зелёной точкой.
4. Настройки хранятся на этой машине, в файлы моделей не попадают.

Требования на рабочем месте: SketchUp 2024 (Windows), сеть до сервера.
V-Ray для `render_vray` — по желанию, плагин сам видит, есть ли он.

## 3. Первая проверка у клиента

В окне плагина, на тестовой модели:

1. «Построй куб 500 мм у начала координат» → карточка execute_ruby,
   куб появился, Ctrl+Z его убирает.
2. Выделить куб → «покрась это в красный» → красится только он.
3. «Сделай лестницу» → карточка с вопросами, ответить → построено.
4. «Попроси снимок вьюпорта» → карточка «Разрешить» → модель описала вид.
5. Если есть V-Ray: «черновой рендер V-Ray 800×450 в папку D:\рендеры».
6. Если `RENDER_ENABLED=1`: «сделай визуализацию этого вида».

## 4. Частые проблемы

- **Красная точка, «пропуск не принят»** — `PLUGIN_TOKEN` в `.env` и в
  плагине различаются или сервис не перезапущен после правки `.env`.
- **Провайдер «не настроен»** — нет входа: см. раздел про вход, после
  входа `sudo systemctl restart stultus-gateway`.
- **Ход идёт бесконечно без вызовов** — сервер не достаёт до API моделей:
  проверить прокси и `NODE_USE_ENV_PROXY=1`.
- **Codex: «refresh token was revoked»** — повторить
  `codex login --device-auth`.
- **Модель «не знает» новых инструментов** после обновления — начать новый
  разговор (корзина в шапке).
- **Прямые вызовы V-Ray/Enscape запрещены** — так и задумано; рендер
  только через `render_vray`.

Подробнее: [USER-GUIDE.md](USER-GUIDE.md) — как пользоваться,
[ARCHITECTURE.md](ARCHITECTURE.md) — как устроено, [AGENT-GUIDE.md](AGENT-GUIDE.md) —
для агентов, дорабатывающих плагин.
