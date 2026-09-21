/**
 * Доработка готового кадра из окна: человек рисует область на результате,
 * даёт задание, референсы и силу, и генерация идёт без хода модели.
 *
 * Размер наследуется: маленький кадр дорабатывается целиком, большой
 * (4K–8K) приходит из окна кусками (`render_upload`), область вырезается
 * из полного файла, генерируется в родном разрешении (при нужде плитками)
 * и вклеивается обратно. Результат возвращается тем же `render_result`
 * (+ `render_chunk` для большого), что и обычная визуализация.
 */
import sharp from 'sharp'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { config } from './config.ts'
import type { PluginConnection, PluginMessage } from './connection.ts'
import { sendFrame, PREVIEW_WIDTH } from './frames.ts'
import { pngImage, renderConfigured, renderViewport, runNative, type EditOptions } from './render.ts'
import { editRegion, gridFor, pngSize, SINGLE_BUDGET } from './region.ts'
import { tiledGenerate } from './tiles.ts'

type EditMessage = Extract<PluginMessage, { type: 'render_edit' }>
type UploadMessage = Extract<PluginMessage, { type: 'render_upload' }>

const MAX_UPLOAD = 400 * 1024 * 1024
const UPLOAD_TTL_MS = 30 * 60 * 1000

const running = new WeakMap<PluginConnection, Map<string, AbortController>>()
const uploads = new WeakMap<PluginConnection, Map<string, { total: number; parts: Array<Buffer | undefined>; bytes: number; started: number }>>()

function editsOf(conn: PluginConnection): Map<string, AbortController> {
  let map = running.get(conn)
  if (!map) { map = new Map(); running.set(conn, map) }
  return map
}
function uploadsOf(conn: PluginConnection) {
  let map = uploads.get(conn)
  if (!map) { map = new Map(); uploads.set(conn, map) }
  return map
}

export function cancelEdit(conn: PluginConnection, id: string): void {
  editsOf(conn).get(id)?.abort()
  uploadsOf(conn).delete(id)
}

export function cancelAllEdits(conn: PluginConnection): void {
  for (const c of editsOf(conn).values()) c.abort()
  uploads.delete(conn)
}

/** Кусок полного кадра из окна. Порядок произвольный, собирается по индексам. */
export function receiveUpload(conn: PluginConnection, msg: UploadMessage): void {
  const id = String(msg.id ?? '')
  if (!/^[0-9a-f-]{36}$/.test(id) || typeof msg.data !== 'string') return
  const total = Number(msg.total), index = Number(msg.index)
  if (!Number.isInteger(total) || total <= 0 || total > 400 || !Number.isInteger(index) || index < 0 || index >= total) return
  const map = uploadsOf(conn)
  // Забытые загрузки не копятся в памяти.
  for (const [key, u] of map) if (Date.now() - u.started > UPLOAD_TTL_MS) map.delete(key)
  let u = map.get(id)
  if (!u) { u = { total, parts: new Array(total), bytes: 0, started: Date.now() }; map.set(id, u) }
  if (u.parts[index]) return
  const part = Buffer.from(msg.data, 'base64')
  if (u.bytes + part.length > MAX_UPLOAD) { map.delete(id); return }
  u.parts[index] = part; u.bytes += part.length
}

function takeUpload(conn: PluginConnection, id: string): Buffer {
  const u = uploadsOf(conn).get(id)
  uploadsOf(conn).delete(id)
  if (!u) throw new Error('Полный кадр не дошёл до сервера: повторите доработку.')
  const missing = u.parts.findIndex(p => !p)
  if (missing >= 0) throw new Error(`Полный кадр дошёл не целиком (нет куска ${missing + 1} из ${u.total}): повторите доработку.`)
  return Buffer.concat(u.parts as Buffer[])
}

export async function runEdit(conn: PluginConnection, msg: EditMessage): Promise<void> {
  const id = String(msg.id ?? '')
  if (!/^[0-9a-f-]{36}$/.test(id)) return
  const controller = new AbortController()
  editsOf(conn).set(id, controller)
  const progress = (text: string) => conn.send({ type: 'render_status', id, text })
  try {
    if (!renderConfigured()) throw new Error('Генерация не подключена: нужен вход Codex на gateway и RENDER_ENABLED=1.')
    const base: Buffer = msg.base_upload ? takeUpload(conn, id) : Buffer.from(String(msg.base ?? ''), 'base64')
    const { width, height } = pngSize(base)
    const prompt = String(msg.prompt ?? '').trim().slice(0, 6000) || 'Доработать отмеченную область, сохранив всё остальное.'
    const opts: EditOptions = {
      mask: msg.mask ? pngImage(msg.mask) : undefined,
      references: Array.isArray(msg.references) && msg.references.length ? msg.references.filter(r => typeof r === 'string').slice(0, 10).map(pngImage) : undefined,
      strength: typeof msg.strength === 'number' ? msg.strength : undefined,
    }
    const large = width * height > SINGLE_BUDGET
    console.log(`[доработка] ${id.slice(0, 8)} ${width}×${height}${opts.mask ? ' по маске' : ''}${opts.references?.length ? ` с референсами (${opts.references.length})` : ''}${large ? ' в полном разрешении' : ''}`)
    let file: Buffer, generations = 1
    if (opts.mask && large) {
      // Большой кадр: область из полного файла, генерация в родном разрешении.
      const result = await editRegion(base, Buffer.from(opts.mask.base64, 'base64'), prompt, opts, controller.signal, t => progress(`Доработка: ${t}`))
      file = result.file; generations = result.generations
    } else if (large) {
      // Без маски на большом кадре: весь кадр плитками, размер тот же.
      const root = resolve(config.workDir, 'renders')
      await mkdir(root, { recursive: true, mode: 0o700 })
      const directory = await mkdtemp(join(root, 'edit-'))
      try {
        const result = await tiledGenerate(base, width, height, { grid: gridFor(width, height), prompt, generate: runNative, progress: t => progress(`Доработка: ${t}`), signal: controller.signal, directory, baseOpts: opts })
        file = result.stitched; generations = result.generations
      } finally { await rm(directory, { recursive: true, force: true }) }
    } else {
      progress(opts.mask ? 'Дорабатываю отмеченную область…' : 'Создаю новую версию кадра…')
      const image = await renderViewport(pngImage(base.toString('base64')), prompt, controller.signal, opts)
      file = Buffer.from(image.base64, 'base64')
    }
    controller.signal.throwIfAborted()
    const sourcePreview = width > PREVIEW_WIDTH ? pngImage((await sharp(base).resize({ width: PREVIEW_WIDTH }).png().toBuffer()).toString('base64')) : pngImage(base.toString('base64'))
    const sent = await sendFrame(conn, id, { file, width, height, source: sourcePreview, prompt, edit: true })
    console.log(`[доработка] ${id.slice(0, 8)} готово ${width}×${height}, генераций ${generations}${sent.large ? ', файл кусками' : ''}`)
  } catch (error) {
    const text = controller.signal.aborted ? 'Доработка остановлена.' : error instanceof Error ? error.message : String(error)
    console.log(`[доработка] ${id.slice(0, 8)} ${text}`)
    conn.send({ type: 'render_status', id, text, failed: true })
  } finally {
    editsOf(conn).delete(id)
    uploadsOf(conn).delete(id)
  }
}

