import type { IncomingMessage, ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import type { PluginConnection } from './connection.ts'
import { randomUUID } from 'node:crypto'
import { pngImage, renderConfigured, renderViewport } from './render.ts'

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
export const TOOL_NAMES = ['execute_ruby', 'get_scene', 'select', 'take_screenshot', 'render_viewport', 'undo', 'ask_user'] as const

function build(conn: PluginConnection): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: '0.1.0' })

  server.registerTool('render_viewport', {
    title: 'Визуализация текущего кадра',
    description: 'Создаёт постпродакшн-картинку из точно выставленного пользователем вьюпорта. ' +
      'Плагин попросит согласие, зафиксирует текущий кадр и передаст его встроенному генератору Codex. ' +
      'Камера, выделение и геометрия не меняются. Результат появляется в чате с исходником и кнопкой сохранения. ' +
      'Используй только по просьбе сделать визуализацию/рендер/постпродакшн. Не вызывай select с zoom или ' +
      'execute_ruby перед этим: ракурс уже выбрал пользователь. Не нужен отдельный take_screenshot.',
    inputSchema: { prompt: z.string().trim().min(1).max(6000).describe('Пожелания к свету, материалам и атмосфере; сохранить архитектуру и ракурс') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ prompt }) => {
    const id = randomUUID(), signal = conn.running?.signal
    try {
      if (!renderConfigured()) throw new Error('Генерация ещё не подключена: нужен вход Codex на gateway и RENDER_ENABLED=1.')
      if (!signal || signal.aborted) throw new Error('Визуализация доступна только в активном ходе пользователя.')
      const shot = await conn.callTool('render_viewport', { prompt, render_id: id })
      if (!shot.ok || !shot.image) return { content: [{ type: 'text' as const, text: shot.content || 'Пользователь не разрешил визуализацию.' }], isError: !shot.ok }
      signal.throwIfAborted()
      if (shot.capture?.framing !== 'viewport') throw new Error('Обновите плагин: снимок должен сохранять кадрирование вьюпорта.')
      const source = pngImage(shot.image.base64)
      conn.send({ type: 'render_status', id, text: 'Создаю визуализацию. Это может занять несколько минут…' })
      const image = await renderViewport(source, prompt, signal)
      signal.throwIfAborted()
      conn.send({ type: 'render_result', id, prompt, source, image })
      const changedRatio = Math.abs(image.width / image.height / (source.width / source.height) - 1) > 0.02
      return { content: [
        { type: 'text' as const, text: `Постпродакшн-кадр ${image.width}×${image.height} показан пользователю. Исходник ${source.width}×${source.height}. Геометрия SketchUp не менялась. Это ИИ-визуализация: сравни её с исходником, не обещай точность геометрии.` + (changedRatio ? ' Формат результата отличается от исходного — сообщи пользователю.' : '') },
        { type: 'image' as const, data: image.base64, mimeType: image.mime },
      ] }
    } catch (error) {
      const text = signal?.aborted ? 'Визуализация остановлена.' : error instanceof Error ? error.message : String(error)
      conn.send({ type: 'render_status', id, text, failed: true })
      return { content: [{ type: 'text' as const, text }], isError: true }
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
      const r = await conn.callTool('take_screenshot', { reason, view: view === 'current' ? undefined : view, zoom_extents })
      const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
        { type: 'text', text: r.content },
      ]
      if (r.image) content.push({ type: 'image', data: r.image.base64, mimeType: r.image.mime })
      return { content, isError: !r.ok }
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
        'Задать пользователю вопрос и закончить ход. Ответ придёт следующим сообщением. Используй, ' +
        'когда не хватает размера, места или смысла — не угадывай.',
      inputSchema: {
        question: z.string().describe('Вопрос по-русски'),
        options: z.array(z.string()).max(6).optional().describe('Варианты ответа кнопками'),
      },
    },
    async ({ question, options }) => {
      const r = await conn.callTool('ask_user', { question, options })
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
