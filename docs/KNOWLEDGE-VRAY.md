# База знаний: V-Ray и Enscape из Stultus

Проверено 2026-09-14 на живом SketchUp 2024 (24.0.484), V-Ray for SketchUp
6.20.03, Enscape 4.1.0. Каждый пункт — отдельная проба через мост,
скрипты в `tests/kb/`, отчёты в `build/kb/`. Всё, что не помечено
«проверено», в код не попадает.

## Главное правило

Нативный плагин при неверном вызове роняет **весь SketchUp** (fail-fast в
ucrtbase.dll, код 0xc0000409). Это не Ruby-исключение: `rescue` не ловит,
Undo не поможет, несохранённая работа теряется. Поэтому:

- модель не зовёт `VRay::`/`Enscape` из `execute_ruby` — Runner отклоняет
  такой код (`NATIVE_GUARD`), а системная подсказка запрещает исследовать
  чужие API перебором;
- рендер идёт через инструмент `render_vray`, внутри которого только
  вызовы из этого файла;
- новый вызов добавляется сюда только после пробы на живом SketchUp.

Что именно уронило SketchUp 2026-09-13 (ход Codex): чтение параметра
плагина **строковым ключом** `plugin['img_width']`. По документации ключ —
только `Symbol`. Символом читается и пишется без проблем.

## Где документация

В дистрибутиве V-Ray, офлайн:
`C:\Program Files\Chaos Group\V-Ray\V-Ray for SketchUp\extension\documentation\index.html`
(YARD, классы `VRay::Context`, `Command`, `Scene`, `Scene::Plugin`,
`VRayRenderer`, `VRayImage`, `ModelExporter`). Сайт docs.chaos.com отдаёт
403 без входа. Ruby-код самого плагина зашифрован (`.rbc`), читать нечего.

## V-Ray — проверенные вызовы

| Вызов | Результат | Проба |
|---|---|---|
| `VRay::Context.active(false)` | контекст или nil, не создаёт | p01 |
| `ctx.model / ctx.scene / ctx.renderer` | `Sketchup::Model`, `VRay::Scene`, `VRay::VRayRenderer` | p01 |
| `renderer.state` | `:idleDone`, `:preparing`, `:rendering`, `:idleStopped`, `:idleError`, `:fatalError`… | p02 |
| `renderer.render_mode` | `:production` (ещё `:interactive`, `…Cuda`, `…Optix`) | p02 |
| `scene.each { \|p\| p.name; p.type; p.category }` | 37 плагинов, из них 24 `:settings` | p03 |
| `scene['/SettingsOutput']` | `VRay::Scene::Plugin`, `valid?` = true | p04 |
| `plugin.dump` | текст со всеми параметрами и типами | p05 |
| `plugin[:img_width]` (Symbol) | 800; `each { \|name, value, ud, fp\| }` даёт 63 параметра | p06 |
| `scene.change { out[:img_width] = 640 }` | пишется и читается назад | p07 |
| `renderer.subscribe(obj)` с `on_state_changed(r, old, new, instant)` | события: idleDone → idleInitialized → preparing → rendering → idleDone | p08 |
| `VRay::Command.render_production(context: ctx)` | возвращает через ~150 мс, рендер в фоне | p08 |
| `renderer.save_vfb_image(path)` | PNG + отдельный `.Alpha.png` | p08 |
| `renderer.image(do_color_correct: true, strip_alpha: true).save(path, format: :png)` | PNG нужного размера, без альфы — **это используем** | p08 |
| `VRay::Command.stop_current_render(context: ctx)` | документирован; используется по таймауту | — |

Тест-модель 400×225 отрендерилась за 1 с; 480×270 draft — 1,1 с.

Сохранение на диск: инструмент `render_vray` принимает `save_path` — файл
`.png` или папку (существующая папка либо слеш на конце → файл
`stultus_vray_<дата>.png` в ней; путь без расширения → файл `.png`).
Пишется тем же `img.save`, папки создаются, кириллица и обратные слеши
в пути проверены (v11). Собственное автосохранение V-Ray через
`/SettingsOutput` (`img_file`, `img_dir`, `save_render`) записью не
проверялось и не используется.
Рендерится **текущая камера вьюпорта**.

### Параметры, которые трогаем

`/SettingsOutput`: `img_width`, `img_height` (int). Есть ещё `img_file`,
`img_dir`, `save_render` (userdata) — не используем, картинку берём из
буфера.

`/SettingsImageSampler` (`type = 3`, прогрессивный): `progressive_maxSubdivs`
(int, по умолчанию 20), `progressive_threshold` (float, 0.04). Пресеты в
`vray.rb`: draft 6/0.1, medium 20/0.04, high 40/0.01. После рендера всё
возвращается как было.

### Что ещё есть в сцене (для будущих инструментов, не проверено записью)

`/SettingsCamera` (fov, override_width/height), `/RenderView`
(transform, fov, orthographic), `/SettingsGI` (on, primary/secondary_engine),
`/SettingsRTEngine` (gpu/cpu параметры), `/SettingsEnvironment`,
`/CameraPhysical`. Команды `VRay::Command.create_*_light`, `export_vrscene`,
`render_interactive`, `render_batch` документированы, не пробовались.

## Enscape — что есть

- Ruby API **нет**. Загрузчик `enscape/loader.rb` через Fiddle поднимает
  .NET-библиотеку `EnscapeSketchupPluginHost.so`. Модуль `Enscape` содержит
  только классы-наблюдатели (`ModelObserver`, `SelectionObserver`…),
  `PolygonMesh` и `LayerHelperClass.check_layer_zero`. Ни одного публичного
  метода управления.
- Единственный рычаг — команды меню: «Start Enscape», «Enscape Material
  Editor», «Apply Enscape Settings» и т.д. Их `UI::Command#proc` доступен
  из Ruby (`ObjectSpace.each_object(UI::Command)`), то есть «нажать кнопку»
  можно, но обратной связи нет: Enscape живёт отдельным процессом, снимки
  делаются в его окне. Не автоматизируем; модели велено предложить
  пользователю запустить Enscape самому.

## Как добавлять знания

1. Скрипт-проба в `tests/kb/NN_имя.rb`, отчёт в файл, запуск через мост
   `POST :8080/ruby/execute {"code":"load '…'"}` (кириллица в теле POST не
   проходит, поэтому только `load` файла).
2. После каждой пробы — `GET :8080/instance/info`: жив ли SketchUp.
3. Записать сюда таблицей; только потом менять `src/stultus/vray.rb`.
4. Тестовая модель — не рабочая: вылет теряет несохранённое.
