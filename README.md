# Stultus

Плагин SketchUp 2024 для работы с нейросетью прямо в открытой модели: чат в
окне плагина, модель (Claude Code или Codex) строит и правит геометрию через
Ruby API, видит состояние сцены и — с вашего согласия — снимок вьюпорта.

Версия 0.2.9 · лицензия [Apache 2.0](LICENSE) · © 2026 B&A community

Создатели: [maksarsanjeev](https://github.com/maksarsanjeev),
[Royalb21](https://github.com/Royalb21) — см. [AUTHORS](AUTHORS).

## Что делает

Пишете в окне плагина «сделай лестницу из этого проёма на второй этаж,
ширина 1000» — модель читает снимок сцены, пишет Ruby, исполняет его в
SketchUp, перечитывает результат и отвечает. Каждый её вызов — один пункт
Undo: не понравилось — Ctrl+Z.

- **Два провайдера** на выбор в окне: Claude (через Claude Agent SDK) и
  Codex (через codex CLI). Ключи и подписки живут на общем сервере
  (gateway), на рабочих машинах их нет.
- **Выделение — главный контекст.** Что выделено в SketchUp, видно в строке
  под полем ввода («3 экземпляра «Окно 1200» из 200») и уходит с каждым
  сообщением. «Переделай это окно» меняет одно выделенное окно, остальные
  не трогаются; выделили весь стек — меняется весь стек. Для экземпляра
  компонента модель знает, сколько всего экземпляров, и делает выделенный
  уникальным, если выделены не все. Пусто выделено — спросит, не угадает.
- **Сцена в запросе.** По галочке к сообщению прикладывается компактный
  снимок модели: единицы, объекты верхнего уровня с габаритами в мм, слои,
  материалы, камера. Глубже модель смотрит сама через Ruby.
- **Снимок вьюпорта только по кнопке.** Модель просит и объясняет зачем,
  вы нажимаете «Сделать снимок» или «Отказать». Можно попросить стандартный
  вид и «показать всё» — ваша камера после снимка вернётся на место.
- **Переписка в файле модели.** Хранится в словаре атрибутов
  `BACommunity_Stultus`, лимит 150 КБ (старое отбрасывается), картинки не
  пишутся, свой пункт в Undo не заводит. Открыли файл через неделю —
  разговор на месте, и модель продолжит его с того же места, пока сервер
  помнит сессию. Кнопка «Удалить историю» убирает переписку в архив в том
  же файле, «Восстановить» возвращает.
- **Постпродакшн текущего вида.** Выставили ракурс, попросили «сделай
  визуализацию: вечерний свет, дерево и бетон» — после подтверждения кадр
  вьюпорта уходит в генерацию изображений Codex и возвращается в чат
  презентационным кадром с сохранённым ракурсом. Включается на gateway
  (`RENDER_ENABLED=1`), см. [docs/POSTPRODUCTION.md](docs/POSTPRODUCTION.md).
- **Много окон.** Каждое окно SketchUp — своё соединение с gateway, порты
  не нужны: соединение исходящее.

Инструменты модели: `execute_ruby`, `get_scene`, `select`, `take_screenshot`,
`render_viewport`, `render_vray`, `scenes`, `save_recipe`, `get_recipe`, `undo`,
`ask_user`. Подробно — [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Статус

Тестовая сборка. Релиза нет, готовый пакет не выкладывается. Собирается
локально (`tools\build_rbz.ps1`) и раздаётся напрямую.

Проверено на живом SketchUp 2024 (24.0.484): Codex (gateway локально) —
«построй куб» проходит цикл сцена → код → проверка, снимок вьюпорта через
карточку; Claude (gateway на виртуалке, вход по подписке, выход через
локальный прокси) — «покрась и сдвинь куб» с проверкой по сцене за 12 с,
продолжение сессии между ходами работает.

## Как устроено

```
SketchUp + плагин (Ruby)  ──HtmlDialog──  окно чата (JS)
                                              │ WebSocket, исходящий
                                              ▼
                                   gateway (Node, виртуалка в сети бюро)
                                              │ MCP по localhost
                                              ▼
                                   Claude Code / Codex (процесс на виртуалке)
```

Gateway принимает окна SketchUp и для каждого поднимает MCP-сервер `stultus`
с семью инструментами; Claude и Codex ходят к нему как к обычному MCP.
Вызов инструмента уезжает в окно по WebSocket, окно зовёт Ruby, ответ
возвращается модели. Архитектура — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Установка

Пошаговая инструкция развёртывания у клиента — [docs/DEPLOY.md](docs/DEPLOY.md).

### Плагин (рабочая машина)

1. `tools\build_rbz.ps1` → `build\Stultus-0.2.9.rbz`, установить через
   Extension Manager. Для разработки — `dev_install.ps1` (копирует `src\` в
   Plugins SketchUp 2024) и перезапуск SketchUp.
2. Extensions → Stultus — чат с ИИ → ⚙ → адрес gateway
   (`ws://<хост>:8790/ws`) и пропуск. Хранятся на этой машине, в модель не
   попадают.

### Gateway (виртуалка)

```bash
mkdir -p /opt/stultus/{claude,codex,data}
cp server/deploy/.env.example /opt/stultus/.env   # заполнить PLUGIN_TOKEN и вход к моделям
cd server && docker compose -f deploy/docker-compose.yml up -d --build
curl http://localhost:8790/health
```

Вход к моделям:

- Claude: `CLAUDE_CODE_OAUTH_TOKEN` (печатает `claude setup-token` на
  машине, где выполнен вход) или `ANTHROPIC_API_KEY`.
- Codex: `CODEX_API_KEY` или `docker exec -it stultus-gateway npx codex login --device-auth`
  (auth.json ляжет в том `/opt/stultus/codex`).

Без Docker: `cd server && npm ci && npm run build && PLUGIN_TOKEN=… node dist/index.js`
(Node ≥ 22.12). Для разработки `npm run dev`. На домашней виртуалке
(`hedonism-backend`, 192.168.10.94) gateway стоит именно так: код в
`/opt/stultus/app`, настройки в `/opt/stultus/.env`, сервис systemd
`stultus-gateway` от пользователя, у которого выполнен `claude login`, —
тогда токен Claude в `.env` не нужен. Обновление:
`cd /opt/stultus/app && git pull && cd server && npm ci && npm run build && sudo systemctl restart stultus-gateway`.

Важно про Claude: встроенный в SDK бинарник Claude Code хранит вход отдельно
от установленного `claude`. Без токена в `.env` он отвечает «Not logged in»,
даже если на машине выполнен `claude login`. Обходы для разработки:
`CLAUDE_ASSUME_LOGGED_IN=1` (считать настроенным) и `CLAUDE_CODE_PATH`
(путь к своему исполняемому Claude Code).

## Структура

```
src/stultus.rb            регистратор (SketchupExtension)
src/stultus/main.rb       меню, панель, загрузка модулей
src/stultus/dialog.rb     HtmlDialog и обработчики вызовов из JS
src/stultus/runner.rb     execute_ruby: одна операция, откат при ошибке
src/stultus/scene.rb      снимок сцены
src/stultus/selection.rb  наблюдатель выделения, описание, инструмент select
src/stultus/screenshot.rb снимок вьюпорта
src/stultus/render_assets.rb кадры постпродакшна на диске
src/stultus/vray.rb       рендер V-Ray по официальному API (docs/KNOWLEDGE-VRAY.md)
src/stultus/history.rb    переписка в файле модели
src/stultus/settings.rb   адрес/пропуск в реестре SketchUp
src/stultus/html/         index.html, app.js, app.css — окно
server/                   gateway: src/{index,chat,mcp,connection,config,prompt}.ts, providers/{claude,codex}.ts
server/deploy/            Dockerfile, docker-compose.yml, .env.example
docs/                     DEPLOY, ARCHITECTURE, PROTOCOL, USER-GUIDE, ROADMAP, POSTPRODUCTION, KNOWLEDGE-VRAY, AGENT-GUIDE, DESIGN-BRIEF, UI-CONTRACT
tests/                    live_*.rb — прогоны на живом SketchUp через мост
tools/build_rbz.ps1       сборка пакета
```

## Проверка

Плагин грузится в работающий SketchUp без перезапуска: `load 'C:/…/src/stultus.rb'`
в Ruby-консоли (или через мост `sketchup_mcp_server`). `tests/live_load.rb`
прогоняет все модули и пишет отчёт в `build/live_load_report.txt`.

## Грабли

- **Codex отклонял execute_ruby.** При `approvalPolicy: never` Codex молча
  отклоняет MCP-инструменты без пометки «только чтение» («requires
  approval»). Лечится `default_tools_approval_mode = "approve"` у сервера
  в его конфиге; `auto` не помогает.
- **Лимит времени execute_ruby может вызвать нестабильность.** Прерывание
  идёт из другого потока Ruby и может застать SketchUp посреди вызова API;
  после этого возможны вылеты. Настройка `ruby_timeout` (90 с, 0 = выкл).
- **Новые параметры инструментов не доходят до старых разговоров.** Claude
  Code в продолженной сессии держит описания инструментов с первого хода;
  после обновления gateway модель увидит их только в новом разговоре
  («Удалить историю» или новая модель). Симптом: модель уверяет, что у
  инструмента нет параметра, который уже есть.
- **`load` по мосту возвращает `true`**, а не значение скрипта — тесты пишут
  отчёт в файл.
- **Ruby в SketchUp однопоточный.** Сеть — в JS окна; Ruby только исполняет
  инструменты. Долгий `execute_ruby` держит интерфейс SketchUp, прервать
  его нельзя — модели велено дробить построения.
- **`group.material` не наследуется** вложенными группами; литерал числа в
  API — дюйм. Это в системной подсказке, но модели ошибаются.
- **Переписка дирти-флагом помечает модель** (атрибут записан) — после хода
  SketchUp предложит сохранить файл. Так и задумано.
- Оверлеи инструментов в `write_image` не попадают — снимок содержит только модель.

## Лицензия

Apache 2.0, © 2026 B&A community. Полный текст — [LICENSE](LICENSE).
