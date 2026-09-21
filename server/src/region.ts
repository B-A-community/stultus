/**
 * Доработка области в полном разрешении.
 *
 * Генератор отдаёт ~1,6 мегапикселя, а кадр может быть 4K–8K. Поэтому из
 * полного кадра вырезается область маски с запасом на контекст; если вырез
 * умещается в бюджет генератора — одна генерация в родном разрешении,
 * иначе вырез собирается плитками (тот же конвейер, что у большого кадра).
 * Результат вклеивается по маске обратно: вне области кадр не меняется.
 */
import sharp from 'sharp'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { config } from './config.ts'
import { applyMask, pngImage, renderViewport, runNative, type EditOptions, type RenderImage } from './render.ts'
import { tiledGenerate, type Generate, type Grid } from './tiles.ts'

/** Столько пикселей одна генерация отдаёт без потери деталей. */
export const SINGLE_BUDGET = 2.4e6

export interface Region { left: number; top: number; width: number; height: number }

/** Сетка плиток под размер выреза: плитка около 1,4×1,15 тыс. px. */
export function gridFor(width: number, height: number): Grid {
  const clamp = (v: number) => Math.max(1, Math.min(8, v))
  return { cols: clamp(Math.ceil(width / 1400)), rows: clamp(Math.ceil(height / 1150)) }
}

/** Прямоугольник маски (белое) с запасом; null — маска пуста. */
export async function maskBounds(mask: Buffer, width: number, height: number, marginRatio = 0.25, minSize = 1024): Promise<Region | null> {
  const raw = await sharp(mask).resize(width, height, { fit: 'fill', kernel: 'nearest' }).removeAlpha().greyscale().raw().toBuffer()
  let x0 = width, y0 = height, x1 = -1, y1 = -1
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      if (raw[row + x]! > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    }
  }
  if (x1 < 0) return null
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1
  const margin = Math.max(256, Math.round(Math.max(bw, bh) * marginRatio))
  let left = x0 - margin, top = y0 - margin, right = x1 + margin, bottom = y1 + margin
  // Совсем мелкую область расширяем до минимального окна: генератору нужен контекст.
  const grow = (lo: number, hi: number, limit: number) => {
    const size = hi - lo + 1, need = Math.min(minSize, limit) - size
    if (need > 0) { lo -= Math.ceil(need / 2); hi += Math.ceil(need / 2) }
    if (lo < 0) { hi -= lo; lo = 0 }
    if (hi > limit - 1) { lo -= hi - (limit - 1); hi = limit - 1 }
    return [Math.max(0, lo), Math.min(limit - 1, hi)]
  }
  ;[left, right] = grow(left, right, width)
  ;[top, bottom] = grow(top, bottom, height)
  // Чётные размеры: спокойнее для кодеков и плиток.
  const w = ((right - left + 1) >> 1) << 1, h = ((bottom - top + 1) >> 1) << 1
  return { left, top, width: Math.max(2, Math.min(w, width - left)), height: Math.max(2, Math.min(h, height - top)) }
}

export interface RegionResult { file: Buffer; width: number; height: number; generations: number; region: Region }

export async function editRegion(base: Buffer, mask: Buffer, prompt: string, opts: EditOptions, signal: AbortSignal,
  progress: (text: string) => void, generate: Generate = runNative): Promise<RegionResult> {
  const meta = await sharp(base).metadata()
  const width = meta.width!, height = meta.height!
  const region = await maskBounds(mask, width, height)
  if (!region) throw new Error('Область не отмечена.')
  const crop = await sharp(base).extract(region).png().toBuffer()
  const maskFull = await sharp(mask).resize(width, height, { fit: 'fill', kernel: 'nearest' }).removeAlpha().greyscale().png().toBuffer()
  const maskCrop = await sharp(maskFull).extract(region).png().toBuffer()
  const maskImage = pngImage(maskCrop.toString('base64'))
  const area = region.width * region.height
  let edited: Buffer, generations: number
  if (area <= SINGLE_BUDGET) {
    progress(`Область ${region.width}×${region.height}: одна генерация в родном разрешении…`)
    const image = await renderViewport(pngImage(crop.toString('base64')), prompt, signal, { ...opts, mask: maskImage }, generate)
    edited = Buffer.from(image.base64, 'base64'); generations = 1
  } else {
    const grid = gridFor(region.width, region.height)
    const root = resolve(config.workDir, 'renders')
    await mkdir(root, { recursive: true, mode: 0o700 })
    const directory = await mkdtemp(join(root, 'region-'))
    try {
      progress(`Область ${region.width}×${region.height}: плитки ${grid.cols}×${grid.rows}…`)
      const result = await tiledGenerate(crop, region.width, region.height, {
        grid, prompt, generate, progress, signal, directory,
        baseOpts: { ...opts, mask: maskImage },
        tileOpts: { references: opts.references, strength: opts.strength },
      })
      edited = await applyMask(crop, result.stitched, maskCrop)
      generations = result.generations
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
  progress('Вклеиваю область в кадр…')
  const file = await sharp(base).composite([{ input: edited, left: region.left, top: region.top }]).png({ compressionLevel: 6 }).toBuffer()
  return { file, width, height, generations, region }
}

/** Размеры PNG из заголовка без лимитов по объёму (для больших файлов из окна). */
export function pngSize(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw new Error('Некорректное изображение PNG.')
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
  if (!width || !height || width > 16000 || height > 16000) throw new Error('Недопустимый размер изображения.')
  return { width, height }
}

export type { RenderImage }
