import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { applyMask, editClauses, maskOverlay, pngImage, postproductionPrompt, renderViewport, strengthTier, tilePrompt, type RenderImage } from '../src/render.ts'

async function solid(width: number, height: number, rgb: [number, number, number]): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).png().toBuffer()
}
/** Маска: левая половина белая (менять), правая чёрная (оставить). */
async function halfMask(width: number, height: number): Promise<Buffer> {
  return sharp(await solid(width, height, [0, 0, 0])).composite([{ input: await solid(width / 2, height, [255, 255, 255]), left: 0, top: 0 }]).png().toBuffer()
}
const px = (data: Buffer, w: number, x: number, y: number) => [data[(y * w + x) * 3], data[(y * w + x) * 3 + 1], data[(y * w + x) * 3 + 2]]

test('strength tiers: clamp, default 60 → normal, extremes', () => {
  assert.equal(strengthTier(undefined).value, 60)
  assert.equal(strengthTier(undefined).label, 'обычно')
  assert.equal(strengthTier(-5).value, 0); assert.equal(strengthTier(0).label, 'минимум')
  assert.equal(strengthTier(999).value, 100); assert.equal(strengthTier(100).label, 'максимум')
  assert.match(strengthTier(85).clause, /BOLD/)
})

test('prompt clauses name mask and reference images in order', async () => {
  const img = pngImage((await solid(4, 4, [1, 2, 3])).toString('base64'))
  const both = editClauses({ mask: img, reference: img, strength: 30 })
  assert.match(both[0]!, /SECOND attached image .* EDITABLE REGION/)
  assert.match(both[1]!, /THIRD attached image is a STYLE REFERENCE/)
  assert.match(both[2]!, /RESTRAINED/)
  const refOnly = editClauses({ reference: img })
  assert.match(refOnly[0]!, /SECOND attached image is a STYLE REFERENCE/)
  // В плитке картинки: плитка, эталон, референс — референс третий.
  assert.match(tilePrompt('x', 'pos', { reference: img }), /THIRD attached image is a STYLE REFERENCE/)
  assert.match(postproductionPrompt('brief', { strength: 5 }), /MINIMAL/)
})

test('mask overlay tints only the editable half', async () => {
  const base = await solid(40, 20, [100, 100, 100])
  const over = await maskOverlay(base, await halfMask(40, 20))
  const { data } = await sharp(over).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const left = px(data, 40, 5, 10), right = px(data, 40, 35, 10)
  assert.deepEqual(right, [100, 100, 100])
  assert.ok(left[0]! > 150 && left[1]! < 80, `left=${left}`)
})

test('applyMask keeps pixels outside the mask identical and takes the result inside', async () => {
  const base = await solid(80, 40, [10, 20, 30])
  const result = await solid(30, 15, [200, 210, 220]) // другой размер: растягивается
  const out = await applyMask(base, result, await halfMask(80, 40), 0.3)
  const { data, info } = await sharp(out).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.deepEqual([info.width, info.height], [80, 40])
  assert.deepEqual(px(data, 80, 70, 20), [10, 20, 30])
  assert.deepEqual(px(data, 80, 5, 20), [200, 210, 220])
})

test('renderViewport with mask: generator gets target + overlay + reference, output composited', async () => {
  const base = await solid(64, 32, [50, 60, 70])
  const source = pngImage(base.toString('base64'))
  const reference = pngImage((await solid(10, 10, [1, 1, 1])).toString('base64'))
  const mask = pngImage((await halfMask(64, 32)).toString('base64'))
  let seen: string[] = [], seenPrompt = ''
  const generate = async (sources: string[], _dir: string, prompt: string): Promise<RenderImage> => {
    seen = sources.map(s => s.split(/[\\/]/).pop()!); seenPrompt = prompt
    return pngImage((await solid(64, 32, [250, 0, 0])).toString('base64'))
  }
  const out = await renderViewport(source, 'вечер', AbortSignal.timeout(5000), { mask, reference, strength: 95 }, generate)
  assert.deepEqual(seen, ['viewport.png', 'editable-region.png', 'style-reference.png'])
  assert.match(seenPrompt, /MAXIMUM/)
  const { data } = await sharp(Buffer.from(out.base64, 'base64')).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.deepEqual(px(data, 64, 60, 16), [50, 60, 70])
  assert.deepEqual(px(data, 64, 3, 16), [250, 0, 0])
})
