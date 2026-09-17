# Stultus — мини-гайд для агента (Codex / Claude Code)

Ты работаешь с репозиторием `B-A-community/stultus`. Это плагин SketchUp 2024,
через который нейросеть правит открытую модель. Здесь — как всё устроено, чем
пользоваться и как проверить, что ты подключился.

## 1. Схема

```
SketchUp + плагин (Ruby)  ──HtmlDialog──  окно чата (JS, src/stultus/html/app.js)
                                              │ WebSocket, исходящий: ws://<gateway>:8790/ws
                                              ▼
                              gateway (Node 22, server/) — один на бюро
                                              │ MCP Streamable HTTP, localhost:
                                              │ http://127.0.0.1:8790/mcp/<connection-id>
                                              ▼
                     процесс модели: Claude Code (Agent SDK) или Codex (codex-sdk)
```

- Каждое окно SketchUp = одно WebSocket-соединение = свой MCP-сервер `stultus`
  с bearer-пропуском, уникальным для соединения.
- Провайдер запускается gateway'ем на каждый ход пользователя:
  `server/src/providers/claude.ts`, `server/src/providers/codex.ts`. Оба
  говорят кусками одного вида (`server/src/providers/pieces.ts`).
- Системная подсказка одна на всех: `server/src/prompt.ts`. Для Codex она же
  кладётся в `AGENTS.md` рабочего каталога треда (у Codex нет параметра
  system prompt).
- Что уходит модели с каждым сообщением: текст пользователя + первой строкой
  «[Выделение пользователя в SketchUp: …]» + по галочке JSON-снимок сцены
  (`server/src/chat.ts`, `buildPrompt`).

## 2. Инструменты MCP-сервера `stultus`

Определены в `server/src/mcp.ts`, исполняются Ruby-кодом плагина
(`src/stultus/*.rb`) через окно. Все длины наружу — миллиметры; внутри Ruby
API SketchUp — дюймы (`100.mm`).

| Инструмент | Аргументы | Что возвращает | Кто исполняет |
|---|---|---|---|
| `execute_ruby` | `code` (Ruby), `label?` (имя для Undo) | `result:` inspect последнего выражения, `stdout:`; при ошибке `ОШИБКА: класс: текст`, backtrace, «Операция откачена» | Ruby, одна операция Undo, откат при исключении |
| `get_scene` | — | JSON: `title, path, units, context` (режим редактирования группы), `selection_summary {count,text,by_type,definitions[{name,selected,total}]}`, `selection[]` (подробно), `counts, objects[] (id,type,name,layer,material,bounds_mm{min,max,size}), objects_total, truncated, layers, materials, camera` | Ruby |
| `select` | `ids[]`, `mode? = replace\|add\|clear`, `zoom?` | `selected`, `text`, `missing_ids?`, `outside_context_ids?` | Ruby; только объекты текущего контекста редактирования |
| `take_screenshot` | `reason`, `view? = current\|iso\|top\|front\|right\|back\|left`, `zoom_extents?` | текст + блок `image` (PNG base64) или отказ | **пользователь** нажимает кнопку в окне; камера после снимка возвращается |
| `undo` | — | `ok` | Ruby: `Sketchup.undo` |
| `ask_user` | `question`, `options?[]` (до 6) | «Вопрос показан…» — ход надо закончить | окно показывает карточку; ответ приходит следующим сообщением |

Подробности описания выделения: `Face` → `area_mm2, normal, vertices, owner`;
`Edge` → `length_mm, start_mm, end_mm`; `ComponentInstance` → `definition,
instances_total`. Если выделены не все экземпляры компонента, промпт
предупреждает: перед правкой `instance.make_unique`.

Правила поведения модели (кратко, полностью в `prompt.ts`): «это» = выделенное;
одно окно из двухсот — меняется одно; строить у начала координат; сначала
считать, потом строить; после правки перечитать модель и выделить изменённое
через `select` с `zoom`; никогда не докладывать об успехе без проверки.

## 3. Как подключить себя (Codex) к gateway

Gateway на домашней виртуалке: `192.168.10.94`, ssh `maksar`, сервис
`stultus-gateway` (systemd), код `/opt/stultus/app`, настройки
`/opt/stultus/.env`, health `http://192.168.10.94:8790/health`.

Провайдер Codex считается настроенным, если есть `CODEX_API_KEY` в `.env`
**или** файл `auth.json` в `CODEX_HOME` (по умолчанию `~/.codex` пользователя,
от которого запущен сервис — `maksar`). Проверка: `providers[].configured` в
`/health`.

Варианты входа:

1. `codex login --device-auth` на виртуалке под `maksar` → `~/.codex/auth.json`.
2. Скопировать `auth.json` с машины, где вход уже выполнен (Windows:
   `%USERPROFILE%\.codex\auth.json`), в `/home/maksar/.codex/auth.json`, права 600.
3. `CODEX_API_KEY=…` в `/opt/stultus/.env`.

После любого варианта: `sudo systemctl restart stultus-gateway`, затем в
`/health` должно быть `{"id":"codex","configured":true}`. Модели по умолчанию
из `CODEX_MODELS` (`id:Подпись` через запятую; какие есть — `model/list` у
`codex app-server`) — поправь под свой доступ, `CODEX_DEFAULT_MODEL` тоже.

Что gateway передаёт codex-cli (см. `providers/codex.ts`):

```
-c mcp_servers.stultus.url=http://127.0.0.1:8790/mcp/<id>
-c mcp_servers.stultus.bearer_token_env_var=STULTUS_MCP_TOKEN
-c mcp_servers.stultus.default_tools_approval_mode=approve      # без этого Codex
-c mcp_servers.stultus.tools.<tool>.approval_mode=approve       # отклоняет пишущие инструменты
-c mcp_servers.stultus.tool_timeout_sec=600
approvalPolicy=never, sandboxMode=read-only, webSearch выключен,
workingDirectory=<WORK_DIR>/codex с AGENTS.md
```

Известные грабли Codex: при `approval_policy=never` MCP-инструменты без
`readOnlyHint` отклоняются с «MCP tool call requires approval» — поэтому
`approve`. Текст ответа приходит отдельными `agent_message` на каждый абзац
без разделителя — gateway вставляет `\n\n` при смене `item.id`.

## 4. Как проверить, что всё работает

1. Окно плагина в SketchUp подключено: `/health` → `windows[]` не пуст.
2. В окне выбрать провайдер Codex, написать: «Построй куб 500 мм у начала
   координат, назови группу «Тест», проверь габарит». Ожидание: карточки
   `execute_ruby` → `get_scene`, ответ с bounds 0…500.
3. Выделить что-то в SketchUp: строка под полем ввода меняется на «Контекст
   сцены · 1 группа: Тест». Написать «покрась это в красный» — меняется только
   выделенное.
4. «Попроси снимок вьюпорта в изометрии» → карточка с кнопкой → картинка.
5. «Стоп» посреди длинного хода → строка «Остановлено…», без красной ошибки.

Журнал gateway: `journalctl -u stultus-gateway -f -o cat` — видно каждый
вызов инструмента с временем и ошибки провайдера.

Прогон без окна (только Ruby-часть, нужен запущенный SketchUp с мостом
`sketchup_mcp_server.rb` на `:8080`): `tests/live_*.rb` загружаются через
`POST /ruby/execute {"code":"load 'C:/.../tests/live_load.rb'"}`; отчёты пишутся
в `build/*.txt`, потому что `load` по мосту возвращает `true`.

## 5. Подключиться к MCP напрямую, минуя gateway-провайдер

Для отладки инструментов можно ходить в MCP окна из любого клиента:
`GET /health` → взять `windows[0].id`; пропуск соединения печатается в журнале
gateway при подключении окна (или добавь его в `/health` локально, в проде не
надо). Затем в `~/.codex/config.toml`:

```toml
[mcp_servers.stultus]
url = "http://127.0.0.1:8790/mcp/<id>"
bearer_token_env_var = "STULTUS_MCP_TOKEN"
default_tools_approval_mode = "approve"
```

Так Codex CLI в интерактивном режиме увидит те же шесть инструментов. Это
удобно, чтобы прогнать инструменты руками; в рабочем режиме провайдер
запускает gateway.

## 6. Где что править

| Хочу | Файл |
|---|---|
| Новый инструмент модели | `server/src/mcp.ts` (схема) → `src/stultus/html/app.js` `onToolCall` (маршрут) → `src/stultus/dialog.rb` `register` (обработчик) → Ruby-модуль |
| Изменить поведение модели | `server/src/prompt.ts` |
| Что уходит в промпт с сообщением | `server/src/chat.ts` `buildPrompt`, `src/stultus/scene.rb` |
| Новый провайдер | файл в `server/src/providers/`, регистрация в `server/src/chat.ts` `PROVIDERS` |
| Настройки сервера | `server/src/config.ts`, `server/deploy/.env.example` |
| Окно | `src/stultus/html/` (дизайн Graphite — не менять без нужды; контракт DOM в `docs/UI-CONTRACT.md`) |

Обновить сервер после правок: `cd /opt/stultus/app && git pull && cd server
&& npm ci && npm run build && sudo systemctl restart stultus-gateway`.
Плагин на рабочей машине: `dev_install.ps1` + перезапуск SketchUp
(или `load 'C:/…/src/stultus.rb'` в Ruby-консоли для горячей подгрузки).

Протокол окна↔gateway целиком: `docs/PROTOCOL.md`. Архитектура и границы:
`docs/ARCHITECTURE.md`.
