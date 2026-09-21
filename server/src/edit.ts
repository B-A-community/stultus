/**
 * Доработка готового кадра из окна: человек рисует область на результате
 * (или на снимке), даёт задание, референс и силу, и генерация идёт без
 * хода модели. Результат приходит тем же `render_result`, что и обычная
 * визуализация, и ложится в историю окна.
 */
import type { PluginConnection, PluginMessage } from './connection.ts'
import { pngImage, renderConfigured, renderViewport, type EditOptions } from './render.ts'

type EditMessage = Extract<PluginMessage, { type: 'render_edit' }>

const running = new WeakMap<PluginConnection, Map<string, AbortController>>()

function editsOf(conn: PluginConnection): Map<string, AbortController> {
  let map = running.get(conn)
  if (!map) { map = new Map(); running.set(conn, map) }
  return map
}

export function cancelEdit(conn: PluginConnection, id: string): void {
  editsOf(conn).get(id)?.abort()
}

export function cancelAllEdits(conn: PluginConnection): void {
  for (const c of editsOf(conn).values()) c.abort()
}

export async function runEdit(conn: PluginConnection, msg: EditMessage): Promise<void> {
  const id = String(msg.id ?? '')
  if (!/^[0-9a-f-]{36}$/.test(id)) return
  const controller = new AbortController()
  editsOf(conn).set(id, controller)
  try {
    if (!renderConfigured()) throw new Error('Генерация не подключена: нужен вход Codex на gateway и RENDER_ENABLED=1.')
    const base = pngImage(msg.base)
    const prompt = String(msg.prompt ?? '').trim().slice(0, 6000) || 'Доработать отмеченную область, сохранив всё остальное.'
    const opts: EditOptions = {
      mask: msg.mask ? pngImage(msg.mask) : undefined,
      reference: msg.reference ? pngImage(msg.reference) : undefined,
      strength: typeof msg.strength === 'number' ? msg.strength : undefined,
    }
    console.log(`[доработка] ${id.slice(0, 8)} ${base.width}×${base.height}${opts.mask ? ' по маске' : ''}${opts.reference ? ' с референсом' : ''}`)
    conn.send({ type: 'render_status', id, text: opts.mask ? 'Дорабатываю отмеченную область…' : 'Создаю новую версию кадра…' })
    const image = await renderViewport(base, prompt, controller.signal, opts)
    controller.signal.throwIfAborted()
    conn.send({ type: 'render_result', id, prompt, source: base, image, edit: true })
    console.log(`[доработка] ${id.slice(0, 8)} готово ${image.width}×${image.height}`)
  } catch (error) {
    const text = controller.signal.aborted ? 'Доработка остановлена.' : error instanceof Error ? error.message : String(error)
    console.log(`[доработка] ${id.slice(0, 8)} ${text}`)
    conn.send({ type: 'render_status', id, text, failed: true })
  } finally {
    editsOf(conn).delete(id)
  }
}
