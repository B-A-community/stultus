# Протокол Stultus

Два канала. Оба — JSON.

```
SketchUp (Ruby) ◄─ sketchup.callback / execute_script ─► окно плагина (JS)
                                                              │
                                                     WebSocket, исходящий
                                                              ▼
                                                      gateway на виртуалке
                                                              │
                                              MCP (Streamable HTTP, localhost)
                                                              ▼
                                                  Claude Code / Codex (процесс)
```

## 1. Окно ↔ Ruby

JS зовёт `sketchup.<имя>(id, json)`, Ruby отвечает
`window.Stultus.receive({ id, result })`. Все ответы асинхронные. В `result`
всегда есть `ok` (Ruby добавляет `ok: true`, если обработчик его не вернул).

| Вызов | Аргументы | Ответ |
|---|---|---|
| `ready` | — | `{ settings, history, sessions, instance, selection, archive }` |
| `scene_state` | `{ full? }` | снимок сцены (см. ниже); `full: false` — только единицы, контекст и выделение |
| `select` | `{ ids[], mode?, zoom? }` | `{ selected, text, missing_ids?, outside_context_ids? }` |
| `render_vray` | `{ width?, height?, preset?, timeout? }` | асинхронно `{ ok, mime, base64, width, height, state, seconds }` |
| `execute_ruby` | `{ code, label? }` | `{ ok, result, output }` или `{ ok: false, error, backtrace[], output }` |
| `undo` | `{ turn_id }` | `{ ok, undone, text }` или `{ ok: false, error }` — снимает один шаг модели, только если он из этого хода и лежит сверху истории |
| `undo_turn` | `{ turn_id }` | `{ ok, undone, text }` — кнопка «Отменить ход»: все шаги хода, пока они сверху |
| `undo_info` | `{ turn_id }` | `{ steps }` — сколько шагов хода сверху истории |
| `build_massing` | `{ massing, transparent? }` | `{ ok, built, failed, group_id, seconds, text }` — строит группу «Массинг» из готовых контуров в метрах (см. инструмент) |
| `screenshot` | `{ view?, zoom_extents?, width?, height? }` | `{ ok, mime, base64, width, height, bytes }` |
| `save_history` | `{ messages[] }` | `{ saved }` — сколько сообщений влезло под лимит |
| `save_sessions` | `{ sessions: { claude?, codex? } }` | `{ ok }` |
| `clear_history` | — | `{ archived, archive }` — переписка и сессии уходят в архив (ключ `archive` словаря), лента пустеет |
| `restore_history` | — | `{ restored, messages[], sessions, archive }` — архив встаёт перед текущей перепиской |
| `save_settings` | `{ settings }` | `{ settings }` — полный набор после записи |
| `open_url` | `{ url }` | `{ ok }` |

Ruby → JS без запроса: `window.Stultus.selection({ count, text, by_type, definitions })` при каждом изменении выделения в SketchUp (наблюдатель живёт, пока открыто окно).

Снимок сцены:

```jsonc
{
  "title": "Дом", "path": "C:/…/дом.skp",
  "units": { "length": "mm", "api": "inch" },
  "context": null,                       // или путь редактируемой группы
  "counts": { "Group": 12, "Face": 340, "Edge": 900 },
  "selection": [ { "id": 123, "type": "Group", "name": "Стена", "bounds_mm": {…} } ],
  "objects": [ { "id": 45, "type": "ComponentInstance", "name": "Окно", "definition": "Окно 1200",
                 "layer": "стекло", "material": "Стекло", "bounds_mm": { "min": [0,0,0], "max": [1200,100,1500], "size": [1200,100,1500] } } ],
  "objects_total": 12, "truncated": false,
  "layers": ["Layer0", "стекло"], "materials": ["Стекло"],
  "camera": { "eye": [...], "target": [...], "perspective": true },
  "plugin": "0.1.0"
}
```

Формат сообщения истории (то, что уходит в файл модели):

```jsonc
{ "role": "user" | "assistant", "text": "…", "at": "2026-09-11T18:00:00Z",
  "provider": "Claude",                                   // только у assistant
  "tools": [ { "name": "execute_ruby", "label": "стена", "ok": true } ] }
```

Картинки в историю не пишутся.

## 2. Окно ↔ gateway (WebSocket `/ws`)

### Плагин → gateway

| type | Поля | Смысл |
|---|---|---|
| `hello` | `token`, `instance`, `sessions` | Первое сообщение. Плохой пропуск — закрытие с кодом 4401 |
| `chat` | `turn`, `text`, `provider`, `model`, `scene`, `sessions` | Ход пользователя. `scene` — снимок сцены или `null` |
| `tool_result` | `call_id`, `ok`, `content`, `image?` | Ответ на `tool_call`. `image = { mime, base64 }` только у снимка |
| `cancel` | — | Прервать текущий ход |

### Gateway → плагин

| type | Поля | Смысл |
|---|---|---|
| `welcome` | `version`, `providers[]` | После принятого `hello`. `providers[i] = { id, label, configured, models[], default }` |
| `turn_start` | `turn` | Ход принят |
| `status` | `text` | Строка состояния («модель думает…») |
| `text` | `delta` | Кусок текста ответа |
| `text_replace` | `text` | Полная замена текущего пузыря (провайдеры без дельт) |
| `tool_call` | `call_id`, `name`, `args` | Выполнить инструмент и ответить `tool_result` |
| `ask` | `question`, `options[]` | Вопрос пользователю (карточка) |
| `session` | `provider`, `id` | Идентификатор сессии провайдера — плагин сохраняет в модель |
| `done` | `usage?` | Ход окончен. `usage = { input, output, cached, cost? }` |
| `error` | `message` | Ход оборван с ошибкой |
| `photo` | `id`, `title`, `note?`, `image{mime,base64}` | Снимок с панорамы улицы: карточка в ленте, клик открывает крупно |

### Инструменты (`tool_call.name`)

| name | args | Кто отвечает |
|---|---|---|
| `execute_ruby` | `{ code, label? }` | Ruby, сразу |
| `get_scene` | `{}` | Ruby, сразу |
| `select` | `{ ids?, mode?, zoom? }` | Ruby, сразу |
| `render_vray` | `{ width?, height?, preset? }` | Ruby асинхронно: ответ по событию окончания рендера V-Ray, с картинкой; только если в `instance.renderers` есть `vray` |
| `take_screenshot` | `{ reason, view?, zoom_extents? }` | **пользователь**: карточка «Сделать снимок / Отказать» |
| `undo` | `{}` (окно добавляет `turn_id`) | Ruby, сразу; журнал шагов — `undo_ledger.rb` |
| `build_massing` | `{ label, radius, count, sources[], massing }` | Ruby, сразу. `massing = { place: { lat, lon, label, source }, radius, buildings[], sources[], stats }`; здание: `{ id, type, name?, address?, levels?, height, minHeight?, heightSource: height|levels|2gis|estimate, outer: [[x,y]…], inners: [[[x,y]…]…], area, distance, target? }`, координаты в метрах от точки запроса (X восток, Y север) |
| `street_view` | — | Инструмент сервера, плагину не уходит: готовый кадр приходит отдельным сообщением `photo` |
| `browse` | — | Инструмент сервера: браузер на gateway, снимок окна приходит сообщением `photo` |
| `ask_user` | `{ questions: [{ question, options?, multi? }] }` (старая форма `{ question, options }` тоже принимается) | JS показывает карточку со всеми вопросами (кнопки + «свой вариант»), отвечает «вопросы показаны, закончи ход»; ответы уходят одним сообщением пользователя «Ответы: 1. … — …» |

## 3. Gateway ↔ модель (MCP)

Gateway поднимает для каждого подключённого окна MCP-сервер `stultus` по
адресу `http://127.0.0.1:<port>/mcp/<connection-id>` с bearer-пропуском,
уникальным для соединения. Инструменты — те же пять, что выше; каждый вызов
превращается в `tool_call` по WebSocket и ждёт `tool_result`
(`TOOL_TIMEOUT_MS`, по умолчанию 10 минут).

Сообщения окна без хода модели: `render_edit {id, prompt, base, mask?,
references?, strength?}` — доработка кадра (база и маска — PNG base64),
ответ теми же `render_status`/`render_result` (с `edit: true`);
`render_cancel {id}` останавливает. Для большого кадра перед `render_edit`
идут `render_upload {id, index, total, data}` (полный файл кусками), а в
`render_edit` вместо `base` — `base_upload: true`. В `tool_result` для `render_viewport`
окно добавляет `mask`, `references` (массив PNG base64, до 10) и `strength` (0–100). Отдельно модель ждёт ответа MCP-инструмента до `MCP_TOOL_TIMEOUT_MS` (45 минут): большой кадр 8K живёт внутри одного вызова около 15 минут.

Claude Agent SDK получает сервер через `mcpServers` (`type: http`), Codex —
через `-c mcp_servers.stultus.url=…` и `bearer_token_env_var`.

Ход = `query()` (Claude) или `thread.runStreamed()` (Codex) с промптом
«текст пользователя + снимок сцены в json». Продолжение разговора —
`resume: session_id` / `resumeThread(thread_id)`; идентификаторы лежат в
файле модели (`sessions`), поэтому переписка переживает перезапуск SketchUp,
пока gateway помнит сессию (тома `/root/.claude`, `/root/.codex`).
