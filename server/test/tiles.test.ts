import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { axisWeights, layoutTiles, parseGrid, renderLarge, stitch, tilePosition } from '../src/tiles.ts'
import { pngImage, tilePrompt, type RenderImage } from '../src/render.ts'

test('grid parsing clamps and falls back', () => {
  assert.deepEqual(parseGrid('3x2'), { cols: 3, rows: 2 })
  assert.deepEqual(parseGrid(' 4 × 9 '), { cols: 4, rows: 4 })
  assert.deepEqual(parseGrid('garbage'), { cols: 3, rows: 2 })
})

test('tiles cover the frame with the requested overlap', () => {
  const layout = layoutTiles(3840, 2160, { cols: 3, rows: 2 }, 0.12)
  assert.equal(layout.tiles.length, 6)
  assert.equal(layout.overlapX, Math.round(0.12 * 1280))
  for (const t of layout.tiles) {
    assert.ok(t.left >= 0 && t.top >= 0 && t.left + t.width <= 3840 && t.top + t.height <= 2160, JSON.stringify(t))
  }
  const last = layout.tiles.at(-1)!
  assert.equal(last.left + last.width, 3840)
  assert.equal(last.top + last.height, 2160)
  // Соседние плитки перекрываются ровно на нахлёст.
  const [a, b] = layout.tiles
  assert.equal(a!.left + a!.width - b!.left, layout.overlapX)
  // Одна плитка — весь кадр без нахлёста.
  const single = layoutTiles(100, 50, { cols: 1, rows: 1 }, 0.2)
  assert.deepEqual(single.tiles[0], { col: 0, row: 0, left: 0, top: 0, width: 100, height: 50 })
})

test('overlap weights of neighbours sum to one, frame edges stay at full weight', () => {
  const total = 100, span = 60, ov = 20
  const left = axisWeights(0, span, total, ov), right = axisWeights(40, span, total, ov)
  assert.equal(left[0], 1)
  assert.equal(right[span - 1], 1)
  for (let i = 0; i < ov; i++) {
    const x = 40 + i
    assert.ok(Math.abs(left[x]! + right[i]! - 1) < 1e-6, `x=${x}`)
  }
})

async function solid(width: number, height: number, rgb: [number, number, number]): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).png().toBuffer()
}

test('stitching blends the overlap and keeps the outer pixels', async () => {
  const layout = layoutTiles(200, 100, { cols: 2, rows: 1 }, 0.2)
  const [a, b] = layout.tiles
  const out = await stitch(200, 100, layout, [
    { tile: a!, png: await solid(a!.width, a!.height, [200, 0, 0]) },
    { tile: b!, png: await solid(b!.width, b!.height, [0, 0, 200]) },
  ])
  const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
  assert.deepEqual([info.width, info.height], [200, 100])
  const px = (x: number, y: number) => [data[(y * 200 + x) * 3], data[(y * 200 + x) * 3 + 1], data[(y * 200 + x) * 3 + 2]]
  assert.deepEqual(px(0, 50), [200, 0, 0])
  assert.deepEqual(px(199, 50), [0, 0, 200])
  const mid = px(100, 50)
  assert.ok(mid[0]! > 40 && mid[0]! < 160 && mid[2]! > 40 && mid[2]! < 160, `mid=${mid}`)
})

test('tile prompt names both roles and forbids reframing', () => {
  const p = tilePrompt('вечер', tilePosition({ col: 2, row: 0, left: 0, top: 0, width: 1, height: 1 }, { cols: 3, rows: 2 }))
  assert.match(p, /EDIT the FIRST attached image/)
  assert.match(p, /SECOND attached image is the SAME tile/)
  assert.match(p, /column 3 of 3, row 1 of 2 \(top, right\)/)
  assert.match(p, /Do not zoom, shift, rotate, re-crop/)
})

test('large frame: reference first, then every tile with two images, result at full size', async () => {
  const width = 640, height = 360
  const source = pngImage((await solid(width, height, [90, 120, 150])).toString('base64'))
  const calls: Array<{ sources: string[]; prompt: string }> = []
  const generate = async (sources: string | string[], _dir: string, prompt: string): Promise<RenderImage> => {
    const list = Array.isArray(sources) ? sources : [sources]
    calls.push({ sources: list, prompt })
    // Генератор отдаёт «свой» размер, не совпадающий с плиткой: сшивка должна растянуть.
    return pngImage((await solid(300, 170, [10, 200, 10])).toString('base64'))
  }
  const progress: string[] = []
  const result = await renderLarge(source, 'тёплый вечер', AbortSignal.timeout(20000), t => progress.push(t), generate)
  assert.equal(calls.length, 7)
  assert.equal(calls[0]!.sources.length, 1)
  assert.match(calls[0]!.prompt, /EDIT the attached SketchUp viewport/)
  for (const call of calls.slice(1)) {
    assert.equal(call.sources.length, 2)
    assert.match(call.sources[0]!, /tile-\d+-source\.png$/)
    assert.match(call.sources[1]!, /tile-\d+-reference\.png$/)
  }
  assert.deepEqual([result.image.width, result.image.height], [width, height])
  assert.ok(result.preview.width <= width)
  assert.equal(result.generations, 7)
  assert.ok(progress.some(t => /Эталон/.test(t)) && progress.some(t => /Плитка 6 из 6/.test(t)) && progress.at(-1)!.startsWith('Сшиваю'))
})

test('large frame: abort stops the pipeline without retries', async () => {
  const source = pngImage((await solid(320, 180, [1, 2, 3])).toString('base64'))
  const controller = new AbortController()
  let calls = 0
  const generate = async (): Promise<RenderImage> => {
    calls++
    controller.abort()
    throw new Error('Визуализация остановлена.')
  }
  await assert.rejects(renderLarge(source, 'x', controller.signal, () => {}, generate), /остановлена/)
  assert.equal(calls, 1)
})
