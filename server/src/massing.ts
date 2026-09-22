/**
 * Массинг окружения: точка → здания → контуры в метрах для плагина.
 *
 * Плагин получает готовые к построению данные: локальные координаты в
 * метрах (X на восток, Y на север, начало — точка запроса), высоту и
 * источник высоты каждого здания. Пересчёт из широты/долготы — плоская
 * проекция: на радиусе до полутора километров ошибка меньше сантиметра.
 */
import { config } from './config.ts'
import { enrich2gis, fetchBuildings, type Building, type HeightSource, type Ring } from './buildings.ts'
import { fetchJson, resolvePlace, type GeoPoint, type Place } from './geo.ts'

export type XY = [number, number]

export interface MassingBuilding {
  id: string
  type: string
  name?: string
  address?: string
  levels?: number
  height: number
  minHeight?: number
  heightSource: HeightSource
  /** Контур в метрах от центра, против часовой стрелки. */
  outer: XY[]
  inners: XY[][]
  /** Площадь пятна, м². */
  area: number
  /** Расстояние от центра до центра пятна, м. */
  distance: number
  /** Здание, которое назвал геокодер по адресу запроса. */
  target?: boolean
}

export interface Massing {
  place: Place
  radius: number
  buildings: MassingBuilding[]
  /** Откуда данные: имя зеркала Overpass, 2GIS при ключе. */
  sources: string[]
  stats: { total: number; byHeight: Record<HeightSource, number>; skipped: number; dgis?: { matched: number; total: number } }
}

const M_PER_DEG_LAT = 111_320

/** Плоская проекция кольца в метры относительно центра. */
export function project(center: GeoPoint, ring: Ring): XY[] {
  const kx = M_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180)
  return ring.map(([lon, lat]) => [Math.round((lon - center.lon) * kx * 100) / 100, Math.round((lat - center.lat) * M_PER_DEG_LAT * 100) / 100])
}

function area(ring: XY[]): number {
  let s = 0
  for (let i = 0; i < ring.length; i++) { const a = ring[i]!, b = ring[(i + 1) % ring.length]!; s += a[0] * b[1] - b[0] * a[1] }
  return s / 2
}

/** Убрать повторяющиеся и почти совпадающие точки; развернуть против часовой. */
export function cleanRing(ring: XY[], minStep = 0.05): XY[] {
  const out: XY[] = []
  for (const p of ring) {
    const last = out[out.length - 1]
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < minStep) continue
    out.push(p)
  }
  while (out.length > 1 && Math.hypot(out[0]![0] - out[out.length - 1]![0], out[0]![1] - out[out.length - 1]![1]) < minStep) out.pop()
  if (out.length >= 3 && area(out) < 0) out.reverse()
  return out
}

function centroid(ring: XY[]): XY {
  let x = 0, y = 0
  for (const p of ring) { x += p[0]; y += p[1] }
  return [x / ring.length, y / ring.length]
}

/** Здания OSM → строки массинга в метрах; слишком мелкие и вырожденные — вон. */
export function toMassing(place: Place, radius: number, buildings: Building[], minArea = 4): { buildings: MassingBuilding[]; skipped: number } {
  const out: MassingBuilding[] = []
  let skipped = 0
  for (const b of buildings) {
    const outer = cleanRing(project(place, b.outer))
    const a = outer.length >= 3 ? area(outer) : 0
    if (a < minArea) { skipped++; continue }
    const c = centroid(outer)
    const distance = Math.hypot(c[0], c[1])
    if (distance > radius * 1.5) { skipped++; continue }
    const inners = b.inners.map(r => cleanRing(project(place, r))).filter(r => r.length >= 3 && Math.abs(area(r)) >= 1)
    const target = place.osm ? b.id.startsWith(`${place.osm.type}/${place.osm.id}`) : false
    out.push({
      id: b.id, type: b.type, name: b.name, address: b.address, levels: b.levels, height: b.height, minHeight: b.minHeight, heightSource: b.heightSource,
      outer, inners, area: Math.round(a), distance: Math.round(distance), target: target || undefined,
    })
  }
  // Ближние первыми: если модель покажет список, начнёт с главного.
  out.sort((x, y) => (Number(Boolean(y.target)) - Number(Boolean(x.target))) || x.distance - y.distance)
  return { buildings: out, skipped }
}

/** Точка по тексту, здания вокруг, при ключе — этажность из 2GIS. */
export async function collectMassing(placeText: string, radius: number, signal?: AbortSignal, fetcher: typeof fetchJson = fetchJson): Promise<Massing> {
  const place = await resolvePlace(placeText, signal, fetcher)
  const r = Math.max(30, Math.min(config.geoMaxRadius, Math.round(radius)))
  const fetched = await fetchBuildings(place, r, signal, fetcher)
  const sources = [fetched.source]
  let dgis: { matched: number; total: number } | undefined
  if (config.dgisKey) {
    try { dgis = await enrich2gis(fetched.buildings, place, r, config.dgisKey, signal, fetcher); sources.push('2gis') } catch (error) {
      if (signal?.aborted) throw error
      console.warn('[massing] 2GIS:', error instanceof Error ? error.message : error)
    }
  }
  const { buildings, skipped } = toMassing(place, r, fetched.buildings)
  const byHeight: Record<HeightSource, number> = { height: 0, levels: 0, '2gis': 0, estimate: 0 }
  for (const b of buildings) byHeight[b.heightSource]++
  return { place, radius: r, buildings, sources, stats: { total: buildings.length, byHeight, skipped, dgis } }
}

function describe(b: MassingBuilding): string {
  const who = b.name ? `${b.name}${b.address ? ` (${b.address})` : ''}` : b.address || `${b.type} ${b.id}`
  const floors = b.levels ? `${b.levels} эт.` : ''
  const src = b.heightSource === 'estimate' ? 'оценка' : b.heightSource === 'height' ? 'по высоте OSM' : b.heightSource === '2gis' ? 'этажность 2GIS' : 'этажность OSM'
  return `${who}: ${floors ? `${floors}, ` : ''}${b.height} м (${src}), пятно ${b.area} м², ${b.distance} м от центра${b.target ? ', ЭТО ЗАПРОШЕННЫЙ АДРЕС' : ''}`
}

/** Текст для модели: что найдено, откуда высоты, какие здания оценены. */
export function summarize(m: Massing, limit = 12): string {
  const s = m.stats
  const lines = [
    `Место: ${m.place.label} (${m.place.lat.toFixed(5)}, ${m.place.lon.toFixed(5)}; источник точки: ${m.place.source}). Радиус ${m.radius} м.`,
    `Зданий: ${s.total} (данные: ${m.sources.join(', ')}). Высота по тегу height: ${s.byHeight.height}, по этажности OSM: ${s.byHeight.levels}${s.byHeight['2gis'] ? `, по этажности 2GIS: ${s.byHeight['2gis']}` : ''}, ОЦЕНКА по типу здания: ${s.byHeight.estimate}.` + (s.skipped ? ` Пропущено вырожденных/далёких контуров: ${s.skipped}.` : ''),
  ]
  if (s.total === 0) lines.push('В этом радиусе OSM не знает зданий — попробуйте больший радиус или другую точку.')
  const target = m.buildings.find(b => b.target)
  if (target) lines.push(`Запрошенный адрес: ${describe(target)}.`)
  const shown = m.buildings.slice(0, limit)
  if (shown.length) lines.push(`Ближайшие здания:\n${shown.map(b => `— ${describe(b)}`).join('\n')}` + (m.buildings.length > limit ? `\n… и ещё ${m.buildings.length - limit}.` : ''))
  const estimated = m.buildings.filter(b => b.heightSource === 'estimate')
  if (estimated.length) lines.push(`Высота ОЦЕНЕНА (данных нет) у ${estimated.length} зданий${estimated.length <= 8 ? `: ${estimated.map(b => b.address || b.name || b.id).join('; ')}` : ''}. Предупреди пользователя: такие объёмы условны, этажность можно уточнить.`)
  return lines.join('\n')
}
