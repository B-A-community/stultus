/**
 * Отправка готового кадра в окно. Маленький кадр идёт целиком в
 * `render_result`; большой (шире превью или тяжелее нескольких мегабайт) —
 * превью в ленту, а полный файл кусками `render_chunk`, которые окно пишет
 * на диск по порядку.
 */
import sharp from 'sharp'
import type { PluginConnection } from './connection.ts'
import { pngImage, type RenderImage } from './render.ts'

export const PREVIEW_WIDTH = 1920
const CHUNK = 2 * 1024 * 1024
const INLINE_LIMIT = 6 * 1024 * 1024

export interface FrameToSend { file: Buffer; width: number; height: number; source: RenderImage; prompt: string; edit?: boolean }

/** Превью кадра для ленты и модели: не шире PREVIEW_WIDTH. */
export async function previewOf(file: Buffer, width: number): Promise<RenderImage> {
  if (width <= PREVIEW_WIDTH && file.length <= INLINE_LIMIT) return pngImage(file.toString('base64'))
  const small = await sharp(file).resize({ width: Math.min(PREVIEW_WIDTH, width) }).png().toBuffer()
  return pngImage(small.toString('base64'))
}

/** Отдать кадр окну; возвращает превью (то, что видит модель) и признак «большой». */
export async function sendFrame(conn: PluginConnection, id: string, frame: FrameToSend): Promise<{ shown: RenderImage; large: boolean }> {
  const large = frame.width > PREVIEW_WIDTH || frame.file.length > INLINE_LIMIT
  const shown = await previewOf(frame.file, frame.width)
  if (!large) {
    conn.send({ type: 'render_result', id, prompt: frame.prompt, source: frame.source, image: shown, edit: frame.edit })
    return { shown, large }
  }
  const chunks = Math.ceil(frame.file.length / CHUNK)
  conn.send({ type: 'render_result', id, prompt: frame.prompt, source: frame.source, image: shown, large: true, edit: frame.edit, full: { width: frame.width, height: frame.height, bytes: frame.file.length, chunks } })
  for (let i = 0; i < chunks; i++) conn.send({ type: 'render_chunk', id, index: i, total: chunks, data: frame.file.subarray(i * CHUNK, (i + 1) * CHUNK).toString('base64') })
  return { shown, large }
}
