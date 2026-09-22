import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { bearingTo, distanceTo, findPanorama, pickZoom, renderView, type Panorama } from '../src/panorama.ts'

const RAW = {
  status: 'success',
  data: {
    Data: {
      panoramaId: '1298328991_673337080_23_1756627649',
      timestamp: 1755259200,
      Point: { name: 'Гончарная улица', coordinates: [37.6493579149, 55.7431401783, 0] },
      EquirectangularProjection: { Origin: [154.86, 27.106] },
      Images: {
        imageId: 'BIz4rCwR7vmD',
        Zooms: [{ level: 1, width: 7168, height: 2504 }, { level: 0, width: 17664, height: 6172 }, { level: 3, width: 1792, height: 626 }],
        Tiles: { width: 256, height: 256 },
      },
    },
    Annotation: {
      Thoroughfares: [
        { Direction: [156.256, 0], Connection: { name: 'Гончарная улица', Point: { coordinates: [37.6497, 55.7428] } } },
        { Direction: [-25.14, 0], Connection: { name: 'Гончарная улица', Point: { coordinates: [37.6490, 55.7435] } } },
      ],
      Connections: [],
    },
  },
}

test('описание панорамы: улица, дата, зумы по порядку, азимут левого края, шаги', async () => {
  const pano = (await findPanorama({ lat: 55.7431, lon: 37.6494 }, undefined, async () => RAW))!
  assert.equal(pano.id, '1298328991_673337080_23_1756627649')
  assert.equal(pano.imageId, 'BIz4rCwR7vmD')
  assert.equal(pano.street, 'Гончарная улица')
  assert.equal(pano.date, '2025-08-15')
  assert.equal(pano.origin, 154.86)
  assert.deepEqual(pano.zooms.map(z => z.level), [0, 1, 3])
  // Отрицательное направление приводится к компасному кругу.
  assert.deepEqual(pano.links.map(l => Math.round(l.heading)), [156, 335])
  assert.equal(pano.links[0]!.name, 'Гончарная улица')
  // Пустой ответ сервиса — не панорама, а null.
  assert.equal(await findPanorama({ lat: 0, lon: 0 }, undefined, async () => ({ status: 'error' })), null)
})

test('азимут и расстояние между точками', () => {
  const from = { lat: 55.743140, lon: 37.649358 }
  assert.equal(Math.round(bearingTo(from, { lat: 55.7529, lon: 37.649358 })), 0)
  assert.equal(Math.round(bearingTo(from, { lat: 55.743140, lon: 37.66 })), 90)
  // Дом 26к1 стоит к югу и чуть западнее точки съёмки.
  assert.equal(Math.round(bearingTo(from, { lat: 55.7429091, lon: 37.6491746 })), 204)
  assert.ok(Math.abs(distanceTo(from, { lat: 55.7429091, lon: 37.6491746 }) - 26) < 3)
})

test('уровень детализации подбирается под угол обзора', () => {
  const pano = { zooms: RAW.data.Data.Images.Zooms.slice().sort((a, b) => a.level - b.level) } as Panorama
  // Узкий кадр требует больше пикселей на градус.
  assert.equal(pickZoom(pano, 75, 1280).level, 1)
  assert.equal(pickZoom(pano, 20, 1280).level, 0)
  assert.equal(pickZoom(pano, 110, 400).level, 3)
})

/** Плитка-заглушка: свой цвет у каждой, чтобы проверить раскладку. */
async function fakeTile(_id: string, _level: number, x: number, y: number): Promise<Buffer> {
  const r = (x * 37) % 256, g = (y * 61) % 256, b = 128
  return sharp({ create: { width: 256, height: 256, channels: 3, background: { r, g, b } } }).jpeg().toBuffer()
}

test('кадр с панорамы: нужный размер, цвета на месте, шов не ломает картинку', async () => {
  const pano = (await findPanorama({ lat: 55.7431, lon: 37.6494 }, undefined, async () => RAW))!
  const view = await renderView(pano, { heading: 204, pitch: 15, fov: 75, width: 320, height: 240 }, undefined, fakeTile)
  assert.equal(view.width, 320); assert.equal(view.height, 240)
  assert.equal(view.heading, 204); assert.equal(view.pitch, 15); assert.equal(view.fov, 75)
  const meta = await sharp(view.jpeg).metadata()
  assert.equal(meta.width, 320); assert.equal(meta.height, 240)
  // Кадр не должен быть пустым: у заглушки синий канал 128 в каждой плитке.
  const stats = await sharp(view.jpeg).stats()
  assert.ok(stats.channels[2]!.mean > 100, `синий канал ${stats.channels[2]!.mean}`)
  // Через шов 0/360: курс, при котором кадр захватывает оба края картинки.
  const seam = await renderView(pano, { heading: pano.origin, pitch: 0, fov: 90, width: 320, height: 200 }, undefined, fakeTile)
  const seamStats = await sharp(seam.jpeg).stats()
  assert.ok(seamStats.channels[2]!.mean > 100, 'на шве кадр пустой')
  assert.equal(seam.heading, pano.origin)
})

test('кадр ограничивает размеры и углы разумными пределами', async () => {
  const pano = (await findPanorama({ lat: 55.7431, lon: 37.6494 }, undefined, async () => RAW))!
  const view = await renderView(pano, { heading: 720 + 10, pitch: 999, fov: 999, width: 10, height: 10 }, undefined, fakeTile)
  assert.equal(view.heading, 10)
  assert.equal(view.pitch, 70)
  assert.equal(view.fov, 110)
  assert.equal(view.width, 256)
  assert.equal(view.height, 192)
})
