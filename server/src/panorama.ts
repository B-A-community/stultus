/**
 * Панорамы улиц Яндекса как глаза модели.
 *
 * Браузер на сервере не нужен: панорама отдаётся отдельным сервисом —
 * сначала описание (какая панорама стоит в этой точке, её размеры и куда
 * с неё можно шагнуть), потом плитки 256×256 обычными GET-запросами.
 * Мы забираем только те плитки, что попадают в кадр, склеиваем их и
 * перепроецируем в обычный прямолинейный снимок: вертикали остаются
 * вертикалями, и по фасаду можно честно считать этажи.
 *
 * Раскладка панорамы (проверено на Гончарной улице):
 *   — по горизонтали азимут = Origin[0] + 360 · x / ширина, где азимут это
 *     обычный компасный курс: 0 север, 90 восток;
 *   — по вертикали это верхний кусок полной сферы: y = 0 соответствует
 *     зениту (+90°), шаг 180° на (ширина / 2) пикселей. Низ обрезан, под
 *     ноги панорама не смотрит.
 */
import sharp from 'sharp'
import { config } from './config.ts'
import { USER_AGENT, type GeoPoint } from './geo.ts'

const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  referer: 'https://yandex.ru/maps/',
  'accept-language': 'ru,en',
}

export interface PanoramaLink { heading: number; lat: number; lon: number; name?: string }

export interface Panorama {
  id: string
  imageId: string
  lat: number
  lon: number
  /** Название улицы из описания панорамы. */
  street: string
  /** Дата съёмки, ГГГГ-ММ-ДД. */
  date: string
  /** Уровни детализации: 0 самый крупный. */
  zooms: Array<{ level: number; width: number; height: number }>
  tile: { width: number; height: number }
  /** Азимут левого края картинки, градусы. */
  origin: number
  /** Куда можно шагнуть с этой точки. */
  links: PanoramaLink[]
}

/** Земной радиус для пересчёта шага по панорамам, м. */
const R = 6_371_000

/** Компасный азимут из одной точки в другую, градусы. */
export function bearingTo(from: GeoPoint, to: GeoPoint): number {
  const rad = Math.PI / 180
  const north = (to.lat - from.lat)
  const east = (to.lon - from.lon) * Math.cos(((from.lat + to.lat) / 2) * rad)
  const deg = (Math.atan2(east, north) * 180) / Math.PI
  return (deg + 360) % 360
}

/** Расстояние между точками, м. */
export function distanceTo(from: GeoPoint, to: GeoPoint): number {
  const rad = Math.PI / 180
  const north = (to.lat - from.lat) * rad * R
  const east = (to.lon - from.lon) * rad * R * Math.cos(((from.lat + to.lat) / 2) * rad)
  return Math.hypot(north, east)
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('таймаут')), config.geoTimeoutMs)
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const res = await fetch(url, { headers: HEADERS, signal: controller.signal })
    if (!res.ok) throw new Error(`сервис панорам ответил HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

interface RawPanorama {
  status?: string
  data?: {
    Data?: {
      panoramaId?: string
      timestamp?: number
      Point?: { name?: string; coordinates?: number[] }
      EquirectangularProjection?: { Origin?: number[] }
      Images?: { imageId?: string; Zooms?: Array<{ level: number; width: number; height: number }>; Tiles?: { width: number; height: number } }
    }
    Annotation?: {
      Connections?: Array<{ Direction?: number[]; Connection?: { name?: string; Point?: { coordinates?: number[] }; oid?: string } }>
      Thoroughfares?: Array<{ Direction?: number[]; Connection?: { name?: string; Point?: { coordinates?: number[] }; oid?: string } }>
    }
  }
}

function parsePanorama(raw: unknown, at: GeoPoint): Panorama | null {
  const r = raw as RawPanorama
  const d = r?.data?.Data
  const images = d?.Images
  if (r?.status !== 'success' || !d?.panoramaId || !images?.imageId || !images.Zooms?.length) return null
  const point = d.Point?.coordinates
  const links: PanoramaLink[] = []
  for (const group of [r.data?.Annotation?.Thoroughfares, r.data?.Annotation?.Connections]) {
    for (const item of group ?? []) {
      const coords = item.Connection?.Point?.coordinates
      const heading = item.Direction?.[0]
      if (typeof heading !== 'number') continue
      links.push({
        heading: (heading + 360) % 360,
        lon: coords?.[0] ?? at.lon,
        lat: coords?.[1] ?? at.lat,
        name: item.Connection?.name,
      })
    }
  }
  return {
    id: d.panoramaId,
    imageId: images.imageId,
    lon: point?.[0] ?? at.lon,
    lat: point?.[1] ?? at.lat,
    street: d.Point?.name?.trim() || '',
    date: d.timestamp ? new Date(d.timestamp * 1000).toISOString().slice(0, 10) : '',
    zooms: [...images.Zooms].sort((a, b) => a.level - b.level),
    tile: { width: images.Tiles?.width || 256, height: images.Tiles?.height || 256 },
    origin: ((images ? (d.EquirectangularProjection?.Origin?.[0] ?? 0) : 0) + 360) % 360,
    links,
  }
}

/** Ближайшая панорама к точке; null — в этом месте съёмки нет. */
export async function findPanorama(at: GeoPoint, signal?: AbortSignal, getter = getJson): Promise<Panorama | null> {
  const url = `https://api-maps.yandex.ru/services/panoramas/1.x/?l=stv&lang=ru_RU&origin=userAction&provider=streetview&ll=${at.lon.toFixed(7)}%2C${at.lat.toFixed(7)}`
  return parsePanorama(await getter(url, signal), at)
}

export interface ViewOptions {
  /** Компасный курс камеры, градусы. */
  heading: number
  /** Наклон: плюс вверх, градусы. */
  pitch?: number
  /** Горизонтальный угол обзора, градусы. */
  fov?: number
  width?: number
  height?: number
}

export type TileFetch = (imageId: string, level: number, x: number, y: number, signal?: AbortSignal) => Promise<Buffer | null>

const fetchTile: TileFetch = async (imageId, level, x, y, signal) => {
  const res = await fetch(`https://pano.maps.yandex.net/${imageId}/${level}.${x}.${y}`, { headers: HEADERS, signal })
  if (!res.ok) return null
  return Buffer.from(await res.arrayBuffer())
}

/** Уровень, на котором кадру хватит пикселей: ширина сферы ≈ ширина кадра · 360 / угол. */
export function pickZoom(pano: Panorama, fov: number, width: number): { level: number; width: number; height: number } {
  const need = (width * 360) / Math.max(5, fov)
  const fits = pano.zooms.filter(z => z.width >= need).sort((a, b) => a.width - b.width)
  return fits[0] ?? pano.zooms[0]!
}

/** Ограничение одновременных загрузок плиток. */
async function pool<T, R2>(items: T[], limit: number, run: (item: T) => Promise<R2>): Promise<R2[]> {
  const out: R2[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await run(items[i]!)
    }
  }))
  return out
}

export interface View { jpeg: Buffer; width: number; height: number; heading: number; pitch: number; fov: number; level: number }

/**
 * Прямолинейный кадр с панорамы: как обычная фотография с этой точки.
 *
 * Берём только те плитки, что попадают в кадр (с запасом на склейку),
 * склеиваем их в кусок сферы и для каждого пикселя кадра считаем луч,
 * переводим его в азимут и высоту, а оттуда в пиксель сферы (билинейно).
 */
export async function renderView(pano: Panorama, opts: ViewOptions, signal?: AbortSignal, tiles: TileFetch = fetchTile): Promise<View> {
  const width = Math.max(256, Math.min(2048, Math.round(opts.width ?? 1280)))
  const height = Math.max(192, Math.min(1536, Math.round(opts.height ?? Math.round((width * 3) / 4))))
  const fov = Math.max(20, Math.min(110, opts.fov ?? 70))
  const pitch = Math.max(-30, Math.min(70, opts.pitch ?? 0))
  const heading = ((opts.heading % 360) + 360) % 360
  const zoom = pickZoom(pano, fov, width)

  // Полная сфера была бы в два раза ниже своей ширины; у панорамы низ обрезан.
  const sphereH = zoom.width / 2
  const rad = Math.PI / 180
  const fovV = 2 * Math.atan((Math.tan((fov / 2) * rad) * height) / width)
  const tanH = Math.tan((fov / 2) * rad)
  const tanV = Math.tan(fovV / 2)

  // Луч из камеры в мировые координаты: сначала наклон, потом курс.
  const cp = Math.cos(pitch * rad), sp = Math.sin(pitch * rad)
  const ch = Math.cos(heading * rad), sh = Math.sin(heading * rad)
  const ray = (nx: number, ny: number) => {
    // Камера смотрит вдоль +Z (север при нулевом курсе), +X восток, +Y вверх.
    const x = nx * tanH, y = -ny * tanV, z = 1
    const len = Math.hypot(x, y, z)
    const ux = x / len, uy = y / len, uz = z / len
    // Наклон вокруг оси X: положительный тангаж поднимает взгляд вверх.
    const py = uy * cp + uz * sp, pz = uz * cp - uy * sp
    // Курс вокруг оси Y (по часовой стрелке от севера).
    const wx = ux * ch + pz * sh, wz = pz * ch - ux * sh
    return { x: wx, y: py, z: wz }
  }

  // Рамка нужного куска сферы: считаем по краям и середине кадра.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  const probes: Array<[number, number]> = []
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) probes.push([(i / 4) - 1, (j / 4) - 1])
  for (const [nx, ny] of probes) {
    const d = ray(nx, ny)
    const az = ((Math.atan2(d.x, d.z) * 180) / Math.PI + 360) % 360
    const el = (Math.asin(Math.max(-1, Math.min(1, d.y))) * 180) / Math.PI
    let sx = (((az - pano.origin + 360) % 360) / 360) * zoom.width
    const sy = ((90 - el) / 180) * sphereH
    // Кадр может пересекать шов: разворачиваем координату относительно центра.
    const centreAz = ((heading - pano.origin + 360) % 360) / 360 * zoom.width
    if (sx - centreAz > zoom.width / 2) sx -= zoom.width
    if (centreAz - sx > zoom.width / 2) sx += zoom.width
    minX = Math.min(minX, sx); maxX = Math.max(maxX, sx)
    minY = Math.min(minY, sy); maxY = Math.max(maxY, sy)
  }
  const pad = 2
  const left = Math.floor(minX) - pad, top = Math.max(0, Math.floor(minY) - pad)
  const right = Math.ceil(maxX) + pad, bottom = Math.min(zoom.height, Math.ceil(maxY) + pad)
  const stripW = Math.max(1, right - left), stripH = Math.max(1, bottom - top)

  const cols = Math.ceil(zoom.width / pano.tile.width)
  const firstCol = Math.floor(left / pano.tile.width), lastCol = Math.floor((right - 1) / pano.tile.width)
  const firstRow = Math.floor(top / pano.tile.height), lastRow = Math.floor((bottom - 1) / pano.tile.height)
  const wanted: Array<{ col: number; row: number }> = []
  for (let row = firstRow; row <= lastRow; row++) for (let col = firstCol; col <= lastCol; col++) wanted.push({ col, row })

  const loaded = await pool(wanted, 8, async ({ col, row }) => {
    const wrapped = ((col % cols) + cols) % cols
    const data = await tiles(pano.imageId, zoom.level, wrapped, row, signal)
    return data ? { data, left: col * pano.tile.width - left, top: row * pano.tile.height - top } : null
  })
  const parts = loaded.filter((x): x is { data: Buffer; left: number; top: number } => Boolean(x))
  if (!parts.length) throw new Error('Плитки панорамы не загрузились.')

  // Число каналов берём из ответа sharp: композит может вернуть и RGBA,
  // а разъехавшийся шаг строки превращает кадр в кашу из полос.
  const { data: strip, info } = await sharp({ create: { width: stripW, height: stripH, channels: 3, background: { r: 16, g: 18, b: 20 } } })
    .composite(parts.map(p => ({ input: p.data, left: p.left, top: p.top })))
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  const chan = info.channels
  const stride = stripW * chan

  // Перепроекция: для каждого пикселя кадра берём точку сферы.
  const out = Buffer.allocUnsafe(width * height * 3)
  for (let j = 0; j < height; j++) {
    const ny = ((j + 0.5) / height) * 2 - 1
    for (let i = 0; i < width; i++) {
      const nx = ((i + 0.5) / width) * 2 - 1
      const d = ray(nx, ny)
      const az = ((Math.atan2(d.x, d.z) * 180) / Math.PI + 360) % 360
      const el = (Math.asin(Math.max(-1, Math.min(1, d.y))) * 180) / Math.PI
      let sx = (((az - pano.origin + 360) % 360) / 360) * zoom.width
      const centreAz = ((heading - pano.origin + 360) % 360) / 360 * zoom.width
      if (sx - centreAz > zoom.width / 2) sx -= zoom.width
      if (centreAz - sx > zoom.width / 2) sx += zoom.width
      const sy = ((90 - el) / 180) * sphereH
      const fx = sx - left, fy = sy - top
      const x0 = Math.floor(fx), y0 = Math.floor(fy)
      const o = (j * width + i) * 3
      if (x0 < 0 || y0 < 0 || x0 + 1 >= stripW || y0 + 1 >= stripH) { out[o] = 16; out[o + 1] = 18; out[o + 2] = 20; continue }
      const ax = fx - x0, ay = fy - y0
      const p00 = y0 * stride + x0 * chan, p10 = p00 + chan, p01 = p00 + stride, p11 = p01 + chan
      for (let c = 0; c < 3; c++) {
        const top2 = strip[p00 + c]! * (1 - ax) + strip[p10 + c]! * ax
        const bot = strip[p01 + c]! * (1 - ax) + strip[p11 + c]! * ax
        out[o + c] = (top2 * (1 - ay) + bot * ay) | 0
      }
    }
  }

  const jpeg = await sharp(out, { raw: { width, height, channels: 3 } }).jpeg({ quality: 82 }).toBuffer()
  return { jpeg, width, height, heading, pitch, fov, level: zoom.level }
}

export { USER_AGENT }
