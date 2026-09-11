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

/** Сообщение пользователя вместе со снимком сцены — то, что уходит модели. */
function buildPrompt(text: string, scene: unknown): string {
  if (!scene) return text
  let json: string
  try {
    json = JSON.stringify(scene)
  } catch {
    return text
  }
  return `${text}\n\n[Снимок сцены SketchUp на момент сообщения]\n\`\`\`json\n${json}\n\`\`\``
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
  conn.running = { turn: msg.turn, cancel: () => controller.abort() }
  conn.send({ type: 'turn_start', turn: msg.turn })

  const model = msg.model && provider.models.includes(msg.model) ? msg.model : provider.default
  const resume = conn.sessions[msg.provider]
  const started = Date.now()
  console.log(`[ход ${msg.turn}] ${conn.instance.model_title ?? '?'} → ${provider.label} ${model}${resume ? ' (продолжение)' : ''}`)

  try {
    for await (const piece of provider.run(conn, {
      prompt: buildPrompt(msg.text, msg.scene),
      model,
      resume,
      signal: controller.signal,
    })) {
      switch (piece.kind) {
        case 'text':
          conn.send({ type: 'text', delta: piece.text })
          break
        case 'text_replace':
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
          conn.send({ type: 'done', usage: piece.usage })
          conn.running = null
          break
      }
    }
    if (conn.running) {
      // Провайдер закончил без расхода — прерван или оборван. Ход всё равно закрыт.
      conn.send({ type: 'done' })
    }
    console.log(`[ход ${msg.turn}] готово за ${Math.round((Date.now() - started) / 1000)} с`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[ход ${msg.turn}] ошибка: ${message}`)
    conn.send({ type: 'error', message })
  } finally {
    conn.running = null
  }
}
