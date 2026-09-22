import type { IncomingMessage, ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import type { PluginConnection } from './connection.ts'
import { getRecipe, listRecipes, saveRecipe } from './recipes.ts'
import { randomUUID } from 'node:crypto'
import { pngImage, renderConfigured, renderViewport, strengthTier, type EditOptions, type RenderImage } from './render.ts'
import { LARGE_SIZES, SIZE_IDS, largeGenerations, largeSize, largeSizeList, renderLarge } from './tiles.ts'
import { sendFrame } from './frames.ts'
import { config } from './config.ts'
import { collectMassing, summarize } from './massing.ts'

/**
 * MCP-сервер «stultus» — инструменты одного окна SketchUp.
 *
 * Модель (процесс Claude Code или Codex на этой же машине) ходит сюда по
 * Streamable HTTP: POST /mcp/<connection-id> с bearer-пропуском соединения.
 * Каждый инструмент — это запрос плагину по WebSocket и ожидание ответа.
 *
 * Без сессий MCP (stateless): на каждый запрос новый сервер и транспорт.
 * Инструментов пять, состояния между вызовами нет — держать сессии незачем,
 * а без них не бывает «протухших» сессий после перезапуска.
 */
export const MCP_SERVER_NAME = 'stultus'

/** Что модель называет в описаниях — единый источник для обоих провайдеров. */
export const TOOL_NAMES = ['execute_ruby', 'get_scene', 'select', 'take_screenshot', 'render_viewport', 'render_vray', 'scenes', 'save_recipe', 'get_recipe', 'undo', 'ask_user', 'build_massing'] as const

function build(conn: PluginConnection): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: '0.2.21' })

  server.registerTool('render_viewport', {
    title: 'Визуализация текущего кадра',
    description: 'Создаёт постпродакшн-картинку из точно выставленного пользователем вьюпорта. ' +
      'Плагин попросит согласие, зафиксирует текущий кадр и передаст его встроенному генератору Codex. ' +
      'Камера, выделение и геометрия не меняются. Результат появляется в чате с исходником и кнопкой сохранения. ' +
      'Используй только по просьбе сделать визуализацию/рендер/постпродакшн. Не вызывай select с zoom или ' +
      'execute_ruby перед этим: ракурс уже выбрал пользователь. Не нужен отдельный take_screenshot.',
    inputSchema: {
      prompt: z.string().trim().min(1).max(6000).describe('Пожелания к свету, материалам и атмосфере; сохранить архитектуру и ракурс'),
      size: z.enum(SIZE_IDS).optional().describe(
        'normal (по умолчанию) — один кадр ~1,6 мегапикселя, около минуты. Большие кадры собираются из плиток ' +
        'и стоят генераций и минут: ' + largeSizeList().map(s => `${s.id} — ${s.width} px по ширине, ${s.generations} генераций`).join('; ') +
        '. Выбирай большой размер только по просьбе (4K, 6K, 8K, 2K → 4k, «большой», «для печати»); у швов плиток возможны артефакты.'),
      save_path: z.string().trim().max(500).optional().describe(
        'Куда сохранить готовый кадр на компьютере пользователя: файл .png или папка (создаётся; имя файла подставится). ' +
        'Передавай, если пользователь назвал место. Без него кадр остаётся в чате с кнопкой «Сохранить PNG».'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ prompt, size, save_path }) => {
    const id = randomUUID(), signal = conn.running?.signal
    try {
      if (!renderConfigured()) throw new Error('Генерация ещё не подключена: нужен вход Codex на gateway и RENDER_ENABLED=1.')
      if (!signal || signal.aborted) throw new Error('Визуализация доступна только в активном ходе пользователя.')
      const minutes = Math.round(config.consentTimeoutMs / 60000)
      const shot = await conn.callTool('render_viewport', { prompt, render_id: id, size: size ?? 'normal', sizes: largeSizeList(), save_path: save_path || '' }, {
        timeoutMs: config.consentTimeoutMs,
        timeoutText: `Пользователь не нажал «Зафиксировать и создать» за ${minutes} мин, визуализация не запускалась. Не жди и не вызывай инструмент повторно: скажи пользователю, что визуализация запускается этой кнопкой в карточке, и предложи попросить снова.`,
      })
      if (shot.timedOut) conn.send({ type: 'render_status', id, text: `Кнопку не нажали за ${minutes} мин, запрос снят. Попросите визуализацию ещё раз.`, failed: true })
      if (!shot.ok || !shot.image) return { content: [{ type: 'text' as const, text: shot.content || 'Пользователь не разрешил визуализацию.' }], isError: !shot.ok }
      signal.throwIfAborted()
      if (shot.capture?.framing !== 'viewport') throw new Error('Обновите плагин: снимок должен сохранять кадрирование вьюпорта.')
      const source = pngImage(shot.image.base64)
      // Пользователь мог поправить задание и размер в карточке — генерируем по его выбору.
      const finalPrompt = (shot.prompt ?? '').trim().slice(0, 6000) || prompt
      const edited = finalPrompt !== prompt
      const large = largeSize(shot.size)
      // Дополнения из карточки: маска области, референс стиля, сила задания.
      const opts: EditOptions = {
        mask: shot.mask ? pngImage(shot.mask) : undefined,
        references: shot.references?.length ? shot.references.map(pngImage) : undefined,
        strength: typeof shot.strength === 'number' ? shot.strength : undefined,
      }
      const extras = [opts.mask ? 'меняется только отмеченная область' : '', opts.references?.length ? `по референсам стиля (${opts.references.length})` : '', `сила задания ${strengthTier(opts.strength).value}/100 (${strengthTier(opts.strength).label})`].filter(Boolean).join(', ')
      let shown: RenderImage, sourceShown = source, note = '', width: number, height: number
      if (large) {
        const label = LARGE_SIZES[large].label
        const result = await renderLarge(large, source, finalPrompt, signal, (text, progress) => conn.send({ type: 'render_status', id, text: `Большой кадр ${label}: ${text}`, progress }), undefined, opts)
        signal.throwIfAborted()
        sourceShown = result.source; width = result.width; height = result.height
        // Превью в ленту сразу, полный файл — кусками следом: окно пишет их на диск.
        shown = (await sendFrame(conn, id, { file: result.file, width, height, source: sourceShown, prompt: finalPrompt })).shown
        note = ` Это «большой кадр» ${label} из плиток (${result.generations} генераций, плитки пустого фона взяты из эталона): у швов плиток возможны двоение кромок и разница тона, предупреди пользователя и предложи проверить стыки крупно. Тебе показано уменьшенное превью, полный файл сохранён у пользователя.`
      } else {
        conn.send({ type: 'render_status', id, text: 'Создаю визуализацию. Это может занять несколько минут…', progress: { stage: 'single', done: 0, total: 1, frame: { width: source.width, height: source.height } } })
        const image = await renderViewport(source, finalPrompt, signal, opts); shown = image; width = image.width; height = image.height
        signal.throwIfAborted()
        conn.send({ type: 'render_result', id, prompt: finalPrompt, source: sourceShown, image })
      }
      // Окно подтверждает, что файл целиком лёг на диск, и копирует его по save_path.
      const exported = await conn.callTool('render_export', { render_id: id, save_path: save_path || '' })
      const changedRatio = Math.abs(width / height / (source.width / source.height) - 1) > 0.02
      return { content: [
        { type: 'text' as const, text: `Постпродакшн-кадр ${width}×${height} показан пользователю. Исходник ${source.width}×${source.height}. Геометрия SketchUp не менялась. Это ИИ-визуализация: сравни её с исходником, не обещай точность геометрии. Параметры из карточки: ${extras}.` + note + ` ${exported.content}` + (changedRatio ? ' Формат результата отличается от исходного — сообщи пользователю.' : '') + (edited ? ` Пользователь изменил задание, генерация шла по его тексту: «${finalPrompt}».` : '') },
        { type: 'image' as const, data: shown.base64, mimeType: shown.mime },
      ] }
    } catch (error) {
      const text = signal?.aborted ? 'Визуализация остановлена.' : error instanceof Error ? error.message : String(error)
      conn.send({ type: 'render_status', id, text, failed: true })
      return { content: [{ type: 'text' as const, text }], isError: true }
    }
  })

  server.registerTool('build_massing', {
    title: 'Массинг окружения по карте',
    description: 'Строит в модели массинг — упрощённые объёмы зданий вокруг точки: по адресу, паре координат ' +
      'или ссылке на Яндекс.Карты / 2GIS / Google / OSM (включая ссылки на панораму: координаты берутся из адреса ' +
      'страницы, саму панораму смотреть не нужно и нельзя). Контуры и этажность — OpenStreetMap через зеркало VK Карт, ' +
      'при ключах — геокодеры Яндекса/2GIS и этажность 2GIS. В модели появляется группа «Массинг» на своём слое, ' +
      'внутри группа на здание с именем, адресом, этажностью и высотой; земля Z=0, метры, X на восток, Y на север, ' +
      'начало координат — точка запроса. Здания без данных получают высоту по типу и помечены как оценка — ' +
      'перескажи это пользователю. Вызывай при просьбах «сделай массинг / окружение / подоснову / контекст по ' +
      'адресу, по карте, по ссылке, по панораме». Не рисуй окружение вручную по описанию: этот инструмент даёт ' +
      'реальные контуры. preview: true — только сводка без построения (чтобы обсудить радиус).',
    inputSchema: {
      place: z.string().trim().min(2).max(1000).describe('Адрес («Москва, Гончарная 26к1»), координаты («55.7430, 37.6501») или ссылка на карту/панораму как есть'),
      radius: z.number().int().min(30).max(1500).optional().describe('Радиус вокруг точки в метрах, по умолчанию 250'),
      preview: z.boolean().optional().describe('Только найти и описать здания, ничего не строить'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ place, radius, preview }) => {
    const signal = conn.running?.signal
    try {
      const r = radius ?? 250
      conn.send({ type: 'status', text: `Ищу здания вокруг «${place.slice(0, 60)}» в радиусе ${r} м…` })
      const massing = await collectMassing(place, r, signal)
      const summary = summarize(massing)
      if (preview) return { content: [{ type: 'text' as const, text: `Предпросмотр, в модели ничего не построено.\n${summary}` }] }
      if (!massing.buildings.length) return { content: [{ type: 'text' as const, text: summary }], isError: true }
      const built = await conn.callTool('build_massing', {
        label: massing.place.label, radius: massing.radius, count: massing.buildings.length, sources: massing.sources, massing,
      })
      return { content: [{ type: 'text' as const, text: `${built.content}\n${summary}` }], isError: !built.ok }
    } catch (error) {
      return { content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }], isError: true }
    }
  })

  server.registerTool(
    'execute_ruby',
    {
      title: 'Выполнить Ruby в SketchUp',
      description:
        'Исполняет Ruby-код в открытой модели SketchUp (Ruby API). Возвращает inspect последнего ' +
        'выражения и stdout. Весь вызов — одна операция Undo; ошибка откатывает всё. Длины в API — ' +
        'дюймы: используй .mm на каждой длине. Не оборачивай в start_operation. Код исполняется на ' +
        'главном потоке и не прерывается — дроби тяжёлое на части, не пиши скрипты длиннее ~150 строк.',
      inputSchema: {
        code: z.string().describe('Ruby-код'),
        label: z.string().max(60).optional().describe('Короткое имя действия для пункта Undo, по-русски'),
      },
    },
    async ({ code, label }) => {
      const r = await conn.callTool('execute_ruby', { code, label })
      return { content: [{ type: 'text', text: r.content }], isError: !r.ok }
    },
  )

  server.registerTool(
    'get_scene',
    {
      title: 'Снимок сцены',
      description:
        'Краткое состояние открытой модели: единицы, ТЕКУЩЕЕ ВЫДЕЛЕНИЕ пользователя (подробно: для ' +
        'экземпляров компонентов — сколько всего экземпляров у определения, для граней — площадь, нормаль, ' +
        'хозяин), объекты верхнего уровня (id, тип, имя, слой, материал, габариты в мм), слои, материалы, ' +
        'камера, режим редактирования группы. Список объектов ограничен; глубже — через execute_ruby.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const r = await conn.callTool('get_scene', {})
      return { content: [{ type: 'text', text: r.content }], isError: !r.ok }
    },
  )

  server.registerTool(
    'select',
    {
      title: 'Выделить объекты',
      description:
        'Меняет выделение в SketchUp: выделяет объекты по их id (из get_scene или execute_ruby), ' +
        'добавляет к текущему или снимает выделение. С zoom камера наводится на выделенное. ' +
        'Используй, чтобы показать пользователю результат или спросить «вы имели в виду вот эти?». ' +
        'Выделить можно только объекты текущего контекста редактирования.',
      inputSchema: {
        ids: z.array(z.number().int()).max(500).optional().describe('entityID объектов'),
        mode: z.enum(['replace', 'add', 'clear']).optional().describe('replace (по умолчанию), add, clear'),
        zoom: z.boolean().optional().describe('Навести камеру на выделенное'),
      },
    },
    async ({ ids, mode, zoom }) => {
      const r = await conn.callTool('select', { ids: ids ?? [], mode: mode ?? 'replace', zoom: zoom ?? false })
      return { content: [{ type: 'text', text: r.content }], isError: !r.ok }
    },
  )

  server.registerTool(
    'take_screenshot',
    {
      title: 'Снимок вьюпорта',
      description:
        'Просит у пользователя снимок вьюпорта SketchUp. Пользователь увидит твою причину и нажмёт ' +
        '«Сделать снимок» или «Отказать». Снимок приходит картинкой. Можно попросить стандартный вид ' +
        'и «показать всё» — камера пользователя после снимка вернётся на место. Проси, когда нужно ' +
        'проверить форму или компоновку; отказ — не ошибка.',
      inputSchema: {
        reason: z.string().describe('Зачем нужен снимок, одной фразой по-русски'),
        view: z.enum(['current', 'iso', 'top', 'front', 'right', 'back', 'left']).optional().describe('Ракурс; по умолчанию текущий'),
        zoom_extents: z.boolean().optional().describe('Показать всю модель в кадре'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ reason, view, zoom_extents }) => {
      const r = await conn.callTool('take_screenshot', { reason, view: view === 'current' ? undefined : view, zoom_extents }, {
        timeoutMs: config.consentTimeoutMs,
        timeoutText: `Пользователь не ответил на запрос снимка за ${Math.round(config.consentTimeoutMs / 60000)} мин. Не жди и не повторяй: продолжай без снимка или закончи ход.`,
      })
      const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
        { type: 'text', text: r.content },
      ]
      if (r.image) content.push({ type: 'image', data: r.image.base64, mimeType: r.image.mime })
      return { content, isError: !r.ok }
    },
  )

  server.registerTool(
    'render_vray',
    {
      title: 'Рендер V-Ray текущего вида',
      description:
        'Физический рендер текущего вида SketchUp в V-Ray (если он установлен у пользователя — см. ' +
        'renderers в снимке сцены). Камера — текущая во вьюпорте, размер и качество задаются здесь; ' +
        'настройки V-Ray после рендера возвращаются как были. Результат приходит картинкой и показан ' +
        'пользователю. save_path сохраняет PNG на диск пользователя (файл или папка). ' +
        'Работает в фоне, SketchUp не блокируется; draft 1280×720 — секунды, high — минуты. ' +
        'Не вызывай V-Ray через execute_ruby: это запрещено и роняет SketchUp.',
      inputSchema: {
        width: z.number().int().min(64).max(8192).optional().describe('Ширина, px (по умолчанию 1280)'),
        height: z.number().int().min(64).max(8192).optional().describe('Высота, px (по умолчанию 720)'),
        preset: z.enum(['draft', 'medium', 'high']).optional().describe('Качество: draft для проверки, high для финала'),
        save_path: z.string().max(500).optional().describe('Куда сохранить на компьютере пользователя: путь с расширением .png — файл; без расширения — папка (создаётся, имя файла подставится). Без него кадр только показывается'),
      },
    },
    async ({ width, height, preset, save_path }) => {
      const has = (conn.instance.renderers ?? []).some((r) => r.id === 'vray')
      if (!has) return { content: [{ type: 'text', text: 'V-Ray в этом SketchUp не установлен — рендер недоступен.' }], isError: true }
      const r = await conn.callTool('render_vray', { width, height, preset, save_path })
      const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [{ type: 'text', text: r.content }]
      if (r.image) content.push({ type: 'image', data: r.image.base64, mimeType: r.image.mime })
      return { content, isError: !r.ok }
    },
  )

  server.registerTool(
    'scenes',
    {
      title: 'Сцены SketchUp',
      description:
        'Сцены (Pages) модели: list — перечислить с текущей; activate — перейти к сцене (камера, слои); ' +
        'add — сохранить текущий вид новой сценой; update — обновить сцену текущим видом; delete — удалить. ' +
        'Для пакетного рендера: activate каждую сцену, затем render_vray с save_path.',
      inputSchema: {
        action: z.enum(['list', 'activate', 'add', 'update', 'delete']),
        name: z.string().max(200).optional().describe('Имя сцены (кроме list)'),
        description: z.string().max(500).optional().describe('Описание для add'),
      },
    },
    async ({ action, name, description }) => {
      const r = await conn.callTool('scenes', { action, name, description })
      return { content: [{ type: 'text', text: r.content }], isError: !r.ok }
    },
  )

  server.registerTool(
    'save_recipe',
    {
      title: 'Сохранить приём в копилку',
      description:
        'Сохраняет проверенный приём (универсальный Ruby-код с параметрами) в общую копилку бюро. ' +
        'Только по просьбе пользователя «запомнить», после опроса через ask_user о параметрах и названии. ' +
        'Код — Ruby для execute_ruby с плейсхолдерами {{имя_параметра}}; в описании — когда приём подходит.',
      inputSchema: {
        name: z.string().min(2).max(80).describe('Короткое имя по-русски, например «Лестница двухмаршевая»'),
        description: z.string().min(5).max(600).describe('Что делает и когда применять'),
        params: z
          .array(z.object({
            name: z.string().min(1).max(40).describe('имя плейсхолдера без скобок'),
            description: z.string().max(200).optional(),
            default: z.union([z.string(), z.number(), z.boolean()]).optional(),
          }))
          .max(20)
          .optional(),
        code: z.string().min(10).max(20000).describe('Ruby-код с {{плейсхолдерами}}'),
        tags: z.array(z.string().max(30)).max(8).optional(),
      },
    },
    async ({ name, description, params, code, tags }) => {
      const r = saveRecipe({ name, description, params: params ?? [], code, tags: tags ?? [] })
      conn.send({ type: 'recipes', recipes: listRecipes() })
      return { content: [{ type: 'text', text: `Приём «${r.name}» сохранён в копилке (id ${r.id}). Всего приёмов: ${listRecipes().length}.` }] }
    },
  )

  server.registerTool(
    'get_recipe',
    {
      title: 'Взять приём из копилки',
      description: 'Возвращает полный приём (описание, параметры, Ruby-код с плейсхолдерами) по имени. Подставь значения и выполни через execute_ruby.',
      inputSchema: { name: z.string().min(1).max(80) },
      annotations: { readOnlyHint: true },
    },
    async ({ name }) => {
      const r = getRecipe(name)
      if (!r) return { content: [{ type: 'text', text: `Приёма «${name}» нет. Есть: ${listRecipes().map((x) => x.name).join(', ') || 'копилка пуста'}.` }], isError: true }
      return { content: [{ type: 'text', text: JSON.stringify({ name: r.name, description: r.description, params: r.params, code: r.code, tags: r.tags }, null, 1) }] }
    },
  )

  server.registerTool(
    'undo',
    {
      title: 'Отменить',
      description: 'Отменяет последнюю операцию в SketchUp (в том числе твой последний execute_ruby).',
      inputSchema: {},
    },
    async () => {
      const r = await conn.callTool('undo', {})
      return { content: [{ type: 'text', text: r.content }], isError: !r.ok }
    },
  )

  server.registerTool(
    'ask_user',
    {
      title: 'Спросить пользователя',
      description:
        'Задать пользователю ВСЕ уточняющие вопросы одним вызовом и закончить ход. У каждого вопроса ' +
        '2–4 варианта с конкретными значениями (размеры в мм, материалы, места); пользователь может ' +
        'выбрать вариант или написать свой. Ответы на все вопросы придут одним следующим сообщением. ' +
        'Используй до первого изменения модели, когда не хватает размера, места, количества или ' +
        'смысла — не угадывай. Не задавай вопросы по одному в разных ходах.',
      inputSchema: {
        questions: z
          .array(
            z.object({
              question: z.string().min(1).max(300).describe('Вопрос по-русски'),
              options: z.array(z.string().min(1).max(80)).max(6).optional().describe('Варианты ответа кнопками'),
              multi: z.boolean().optional().describe('Можно выбрать несколько вариантов'),
            }),
          )
          .min(1)
          .max(8)
          .optional()
          .describe('Список вопросов — задавай все нужные сразу'),
        // Старая форма — один вопрос; оставлена для совместимости.
        question: z.string().optional(),
        options: z.array(z.string()).max(6).optional(),
      },
    },
    async ({ questions, question, options }) => {
      const list = questions?.length ? questions : question ? [{ question, options }] : []
      if (!list.length) return { content: [{ type: 'text', text: 'Нет вопросов: передай questions[].' }], isError: true }
      const r = await conn.callTool('ask_user', { questions: list })
      return { content: [{ type: 'text', text: r.content }], isError: !r.ok }
    },
  )

  return server
}

/** Обработать один HTTP-запрос к MCP этого соединения. */
export async function handleMcp(conn: PluginConnection, req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const auth = req.headers.authorization ?? ''
  if (auth !== `Bearer ${conn.mcpToken}`) {
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'unauthorized' }))
    return
  }
  const server = build(conn)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  res.on('close', () => {
    void transport.close()
    void server.close()
  })
  await server.connect(transport)
  await transport.handleRequest(req, res, body)
}
