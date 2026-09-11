import { config } from './config.ts'
import type { PluginConnection, PluginMessage, ProviderInfo } from './connection.ts'
import { claudeConfigured, runClaude } from './providers/claude.ts'
import { codexConfigured, runCodex } from './providers/codex.ts'
import type { Piece, RunInput } from './providers/pieces.ts'

type Runner = (conn: PluginConnection, input: RunInput) => AsyncGenerator<Piece>

const PROVIDERS: Record<string, { label: string; configured: () => boolean; models: string[]; default: string; run: Runner }> = {
  claude: {
    label: 'Claude',
    configured: claudeConfigured,
    models: config.claudeModels,
    default: config.claudeDefaultModel,
    run: runClaude,
  },
  codex: {
    label: 'Codex',
    configured: codexConfigured,
    models: config.codexModels,
    default: config.codexDefaultModel,
    run: runCodex,
  },
}

export function providerList(): ProviderInfo[] {
  return Object.entries(PROVIDERS).map(([id, p]) => ({
    id,
    label: p.label,
    configured: p.configured(),
    models: p.models.map((m) => ({ id: m })),
    default: p.default,
  }))
}

/**
 * Сообщение пользователя вместе со снимком сцены — то, что уходит модели.
 *
 * Выделение идёт первым и отдельной строкой: это то, о чём человек говорит
 * «это», и модель должна увидеть его раньше списка объектов.
 */
function buildPrompt(text: string, scene: unknown): string {
  if (!scene || typeof scene !== 'object') return text
  const snap = scene as {
    selection_summary?: { count?: number; text?: string; definitions?: Array<{ name: string; selected: number; total: number }> }
    selection?: unknown[]
  }
  const parts = [text]
  const summary = snap.selection_summary
  if (summary) {
    const lines = [`[Выделение пользователя в SketchUp: ${summary.text ?? 'ничего не выделено'}]`]
    for (const d of summary.definitions ?? []) {
      if (d.total > d.selected) {
        lines.push(
          `Внимание: выделено ${d.selected} из ${d.total} экземпляров компонента «${d.name}». ` +
            'Правка определения затронет все экземпляры — перед правкой сделай выделенным make_unique.',
        )
      }
    }
    parts.push(lines.join('\n'))
  }
  let json: string
  try {
    json = JSON.stringify(scene)
  } catch {
    return parts.join('\n\n')
  }
  parts.push('[Снимок сцены SketchUp на момент сообщения]\n```json\n' + json + '\n```')
  return parts.join('\n\n')
}

/** Один ход: запустить провайдера и переслать поток в плагин. */
export async function runChat(conn: PluginConnection, msg: Extract<PluginMessage, { type: 'chat' }>): Promise<void> {
  if (conn.running) {
    conn.send({ type: 'error', message: 'Предыдущий ход ещё идёт.' })
    return
  }
  const provider = PROVIDERS[msg.provider]
  if (!provider) {
    conn.send({ type: 'error', message: `Неизвестный провайдер: ${msg.provider}` })
    return
  }
  if (!provider.configured()) {
    conn.send({ type: 'error', message: `${provider.label} на gateway не настроен.` })
    return
  }
  if (msg.sessions) conn.sessions = { ...conn.sessions, ...msg.sessions }

  const controller = new AbortController()
  conn.running = { turn: msg.turn, cancel: () => controller.abort(), signal: controller.signal }
  conn.send({ type: 'turn_start', turn: msg.turn })

  const model = msg.model && provider.models.includes(msg.model) ? msg.model : provider.default
  const prompt = buildPrompt(msg.text, msg.scene)
  const started = Date.now()
  const initialToolCalls = conn.toolCalls
  let producedOutput = false

  /**
   * Один запуск провайдера. Возвращает, успел ли он что-то отдать: по этому
   * решается, можно ли повторить ход без продолжения сессии.
   */
  const attempt = async (resume: string | undefined): Promise<boolean> => {
    let produced = false
    console.log(`[ход ${msg.turn}] ${conn.instance.model_title ?? '?'} → ${provider.label} ${model}${resume ? ' (продолжение)' : ''}`)
    for await (const piece of provider.run(conn, { prompt, model, resume, signal: controller.signal })) {
      switch (piece.kind) {
        case 'text':
          producedOutput = true
          produced = true
          conn.send({ type: 'text', delta: piece.text })
          break
        case 'text_replace':
          producedOutput = true
          produced = true
          conn.send({ type: 'text_replace', text: piece.text })
          break
        case 'status':
          conn.send({ type: 'status', text: piece.text })
          break
        case 'session':
          conn.sessions[msg.provider] = piece.id
          conn.send({ type: 'session', provider: msg.provider, id: piece.id })
          break
        case 'usage':
          produced = true
          conn.send({ type: 'done', usage: piece.usage })
          conn.running = null
          break
      }
    }
    return produced
  }

  try {
    const resume = conn.sessions[msg.provider]
    try {
      await attempt(resume)
    } catch (error) {
      // Сессия из файла модели могла остаться от другого gateway (переезд с
      // домашней виртуалки на офисную, переустановка) — тогда провайдер её
      // не находит. Это не повод ронять ход: начинаем разговор заново и
      // говорим об этом пользователю.
      // Never replay a turn that already changed the model or started a paid render.
      if (!resume || controller.signal.aborted || producedOutput || conn.toolCalls !== initialToolCalls) throw error
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[ход ${msg.turn}] продолжить сессию не удалось (${message}); начинаю заново`)
      delete conn.sessions[msg.provider]
      conn.send({ type: 'status', text: 'Прежняя сессия на сервере не найдена — начинаю разговор заново.' })
      await attempt(undefined)
    }
    if (conn.running) {
      // Провайдер закончил без расхода — прерван или оборван. Ход всё равно закрыт.
      conn.send({ type: 'done' })
    }
    console.log(`[ход ${msg.turn}] готово за ${Math.round((Date.now() - started) / 1000)} с`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (controller.signal.aborted) {
      // Остановка по кнопке: SDK после interrupt отдаёт ошибочный результат,
      // но для человека это не ошибка, а его собственное решение.
      console.log(`[ход ${msg.turn}] остановлен пользователем`)
      // Сначала done (окно на нём очищает строку состояния), потом статус.
      conn.send({ type: 'done' })
      conn.send({ type: 'status', text: 'Остановлено. Сделанное осталось в модели, отменить — Ctrl+Z в SketchUp.' })
      return
    }
    console.error(`[ход ${msg.turn}] ошибка: ${message}`)
    conn.send({ type: 'error', message })
  } finally {
    conn.running = null
  }
}
