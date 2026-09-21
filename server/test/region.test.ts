import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { editRegion, gridFor, maskBounds, pngSize } from '../src/region.ts'
import { pngImage, type RenderImage } from '../src/render.ts'

async function solid(width: number, height: number, rgb: [number, number, number]): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).png().toBuffer()
}
async function noisy(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 40 } } }).png().toBuffer()
}
/** Маска: белый прямоугольник на чёрном. */
async function rectMask(width: number, height: number, left: number, top: number, w: number, h: number): Promise<Buffer> {
  return sharp(await solid(width, height, [0, 0, 0])).composite([{ input: await solid(w, h, [255, 255, 255]), left, top }]).png().toBuffer()
}
const px = (data: Buffer, w: number, x: number, y: number) => [data[(y * w + x) * 3], data[(y * w + x) * 3 + 1], data[(y * w + x) * 3 + 2]]

test('grid for a region keeps tiles near the generator budget', () => {
  assert.deepEqual(gridFor(1000, 800), { cols: 1, rows: 1 })
  assert.deepEqual(gridFor(3840, 2160), { cols: 3, rows: 2 })
  assert.deepEqual(gridFor(7680, 4320), { cols: 6, rows: 4 })
})

test('mask bounds: margin, minimum window, clamping; empty mask → null', async () => {
  const r = await maskBounds(await rectMask(4000, 3000, 2000, 1500, 100, 80), 4000, 3000)
  assert.ok(r)
  assert.ok(r!.width >= 1024 && r!.height >= 1024, `окно ${r!.width}×${r!.height}`)
  assert.ok(r!.left <= 2000 && r!.left + r!.width >= 2100 && r!.top <= 1500 && r!.top + r!.height >= 1580)
  const edge = await maskBounds(await rectMask(2000, 1000, 1950, 950, 50, 50), 2000, 1000)
  assert.ok(edge!.left + edge!.width <= 2000 && edge!.top + edge!.height <= 1000)
  assert.equal(await maskBounds(await solid(300, 200, [0, 0, 0]), 300, 200), null)
})

test('pngSize reads dimensions of a large PNG without a payload cap', async () => {
  const big = await solid(5000, 3000, [1, 2, 3])
  assert.deepEqual(pngSize(big), { width: 5000, height: 3000 })
  assert.throws(() => pngSize(Buffer.from('nope')))
})

test('editRegion on a large frame: single generation at native size, pasted back, outside untouched', async () => {
  const width = 4000, height = 2400
  const base = await sharp(await solid(width, height, [40, 90, 140])).composite([{ input: await noisy(3000, 1800), left: 500, top: 300 }]).png().toBuffer()
  const mask = await rectMask(width, height, 1900, 1100, 200, 160)
  const calls: Array<{ n: number; size: [number, number] }> = []
  const generate = async (sources: string | string[]): Promise<RenderImage> => {
    const list = Array.isArray(sources) ? sources : [sources]
    const meta = await sharp(list[0]!).metadata()
    calls.push({ n: list.length, size: [meta.width!, meta.height!] })
    return pngImage((await solid(meta.width!, meta.height!, [250, 10, 10])).toString('base64'))
  }
  const progress: string[] = []
  const out = await editRegion(base, mask, 'x', {}, AbortSignal.timeout(30000), t => progress.push(t), generate)
  assert.deepEqual([out.width, out.height], [width, height])
  assert.equal(out.generations, 1)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.n, 2) // цель + подсветка области
  assert.ok(calls[0]!.size[0] >= 1024 && calls[0]!.size[0] * calls[0]!.size[1] <= 2.4e6, `вырез ${calls[0]!.size}`)
  const { data } = await sharp(out.file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.deepEqual(px(data, width, 100, 100), [40, 90, 140])
  assert.deepEqual(px(data, width, 2000, 1180), [250, 10, 10])
  const orig = await sharp(base).removeAlpha().raw().toBuffer()
  assert.deepEqual(px(data, width, 3500, 2000), px(orig, width, 3500, 2000))
})

test('editRegion with a huge mask goes through tiles and keeps the full size', async () => {
  const width = 4200, height = 2600
  const base = await noisy(width, height)
  const mask = await rectMask(width, height, 300, 300, 3200, 1800)
  let calls = 0
  const generate = async (sources: string | string[]): Promise<RenderImage> => {
    const list = Array.isArray(sources) ? sources : [sources]
    const meta = await sharp(list[0]!).metadata()
    calls++
    return pngImage((await solid(meta.width!, meta.height!, [10, 200, 10])).toString('base64'))
  }
  const out = await editRegion(base, mask, 'x', {}, AbortSignal.timeout(60000), () => {}, generate)
  assert.deepEqual([out.width, out.height], [width, height])
  assert.ok(out.generations > 1 && calls === out.generations, `генераций ${out.generations}`)
  const { data } = await sharp(out.file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.deepEqual(px(data, width, 1500, 1200), [10, 200, 10])
})
