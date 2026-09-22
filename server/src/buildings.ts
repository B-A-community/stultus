/**
 * Контуры зданий с этажностью вокруг точки.
 *
 * Основа — OpenStreetMap через Overpass API: первым в списке зеркало у VK
 * Карт (maps.mail.ru), затем overpass-api.de и kumi.systems; список — в
 * OVERPASS_URLS. Высота: тег height, иначе этажность × высота этажа по
 * типу здания, иначе оценка по типу — и это честно помечается в
 * heightSource, чтобы модель предупредила пользователя.
 *
 * При ключе DGIS_KEY этажность дополняется из 2GIS (у них она есть почти
 * у каждого дома в России): здание 2GIS сопоставляется с контуром OSM по
 * точке внутри контура.
 */
import { config } from './config.ts'
import { fetchJson, type GeoPoint } from './geo.ts'

/** Кольцо контура: [долгота, широта], без повтора первой точки в конце. */
export type Ring = Array<[number, number]>

export type HeightSource = 'height' | 'levels' | '2gis' | 'estimate'

export interface Building {
  /** way/123, relation/456 — идентификатор OSM. */
  id: string
  outer: Ring
  inners: Ring[]
  /** Значение тега building (apartments, office, yes…). */
  type: string
  name?: string
  address?: string
  levels?: number
  /** Высота в метрах над землёй (верх здания). */
  height: number
  /** Нижняя отметка (min_height), если здание висит: арки, мосты. */
  minHeight?: number
  heightSource: HeightSource
  roof?: string
}

interface OverpassElement {
  type: 'way' | 'relation' | 'node'
  id: number
  tags?: Record<string, string>
  geometry?: Array<{ lat: number; lon: number }>
  members?: Array<{ type: string; ref: number; role: string; geometry?: Array<{ lat: number; lon: number }> }>
}

/** Число из длины с единицами: «12», «12,5», «12 m», «40 ft», «12.5m». */
export function parseLength(value: string | undefined): number | undefined {
  if (!value) return undefined
  const m = value.trim().toLowerCase().replace(',', '.').match(/^(-?\d+(?:\.\d+)?)\s*(m|м|ft|'|feet)?$/)
  if (!m) return undefined
  const n = Number(m[1])
  if (!Number.isFinite(n)) return undefined
  return m[2] === 'ft' || m[2] === "'" || m[2] === 'feet' ? n * 0.3048 : n
}

function parseInt10(value: string | undefined): number | undefined {
  if (!value) return undefined
  const n = Number(value.trim().replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined
}

/** Высота этажа по типу здания, м. */
export function levelHeight(type: string): number {
  if (/^(apartments|residential|house|detached|semidetached_house|terrace|dormitory|hotel|bungalow)$/.test(type)) return 3.0
  if (/^(office|commercial|public|civic|government|hospital|school|university|college|kindergarten)$/.test(type)) return 3.6
  if (/^(retail|supermarket|mall|kiosk)$/.test(type)) return 4.0
  if (/^(industrial|warehouse|hangar|factory|manufacture)$/.test(type)) return 5.0
  return 3.2
}

/**
 * Оценка высоты, когда данных нет: этажность, типичная для типа здания.
 * Не претендует на точность — модель обязана сказать пользователю, какие
 * здания оценены.
 */
export function estimateLevels(type: string): number {
  if (/^(garage|garages|shed|hut|kiosk|service|roof|carport|toilets|guardhouse|booth|transformer_tower)$/.test(type)) return 1
  if (/^(house|detached|semidetached_house|bungalow|terrace|cabin)$/.test(type)) return 2
  if (/^(retail|supermarket|commercial|kindergarten)$/.test(type)) return 2
  if (/^(industrial|warehouse|hangar|factory|manufacture|church|cathedral|chapel|temple|mosque|synagogue)$/.test(type)) return 3
  if (/^(school|hospital|university|college|public|civic|government|office|hotel)$/.test(type)) return 4
  if (/^(apartments|dormitory|residential)$/.test(type)) return 5
  return 3
}

/** Высота здания по тегам OSM и её источник. */
export function heightFromTags(tags: Record<string, string>): { height: number; levels?: number; minHeight?: number; source: HeightSource } {
  const type = tags.building || 'yes'
  const levels = parseInt10(tags['building:levels'])
  const roofLevels = parseInt10(tags['roof:levels']) ?? 0
  const minHeight = parseLength(tags.min_height) ?? (parseInt10(tags['building:min_level']) !== undefined ? parseInt10(tags['building:min_level'])! * levelHeight(type) : undefined)
  const height = parseLength(tags.height) ?? parseLength(tags['building:height'])
  if (height !== undefined && height > 0) return { height, levels, minHeight, source: 'height' }
  if (levels !== undefined && levels > 0) return { height: (levels + roofLevels) * levelHeight(type), levels, minHeight, source: 'levels' }
  if (/^(roof|carport)$/.test(type)) return { height: 3.5, minHeight: minHeight ?? 2.8, source: 'estimate' }
  const est = estimateLevels(type)
  return { height: est * levelHeight(type), levels: est, minHeight, source: 'estimate' }
}

function ringOf(points: Array<{ lat: number; lon: number }>): Ring {
  const ring: Ring = points.map(p => [p.lon, p.lat])
  const first = ring[0], last = ring[ring.length - 1]
  if (ring.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) ring.pop()
  return ring
}

const key = (p: [number, number]) => `${p[0]},${p[1]}`

/**
 * Сборка колец из кусков (внешние контуры мультиполигонов часто разбиты
 * на несколько линий): куски стыкуются по совпадающим концам.
 */
export function assembleRings(segments: Ring[]): Ring[] {
  const rest = segments.map(s => s.slice()).filter(s => s.length > 1)
  const rings: Ring[] = []
  while (rest.length) {
    let ring = rest.shift()!
    let closed = key(ring[0]!) === key(ring[ring.length - 1]!)
    let progress = true
    while (!closed && progress) {
      progress = false
      const tail = key(ring[ring.length - 1]!)
      for (let i = 0; i < rest.length; i++) {
        const seg = rest[i]!
        if (key(seg[0]!) === tail) { ring = ring.concat(seg.slice(1)); rest.splice(i, 1); progress = true; break }
        if (key(seg[seg.length - 1]!) === tail) { ring = ring.concat(seg.slice(0, -1).reverse()); rest.splice(i, 1); progress = true; break }
      }
      closed = key(ring[0]!) === key(ring[ring.length - 1]!)
    }
    if (closed) ring.pop()
    if (ring.length >= 3) rings.push(ring)
  }
  return rings
}

/** Площадь кольца по формуле шнурков в условных единицах (знак = направление). */
export function ringArea(ring: Ring): number {
  let s = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s / 2
}

/** Точка внутри кольца (луч вправо, чёт/нечет). */
export function pointInRing(p: [number, number], ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function addressOf(tags: Record<string, string>): string | undefined {
  const street = tags['addr:street'] || tags['addr:place']
  const number = tags['addr:housenumber']
  if (street && number) return `${street}, ${number}`
  return number || street || undefined
}

/** Элементы ответа Overpass → здания. */
export function parseOverpass(data: unknown): Building[] {
  const elements = ((data as { elements?: OverpassElement[] })?.elements ?? [])
  const out: Building[] = []
  for (const el of elements) {
    const tags = el.tags ?? {}
    if (!tags.building || tags.building === 'no') continue
    let outer: Ring[] = [], inners: Ring[] = []
    if (el.type === 'way' && el.geometry) {
      const ring = ringOf(el.geometry)
      if (ring.length >= 3) outer = [ring]
    } else if (el.type === 'relation' && el.members) {
      outer = assembleRings(el.members.filter(m => m.role === 'outer' && m.geometry).map(m => ringOf(m.geometry!)))
      inners = assembleRings(el.members.filter(m => m.role === 'inner' && m.geometry).map(m => ringOf(m.geometry!)))
    }
    if (!outer.length) continue
    const h = heightFromTags(tags)
    // Мультиполигон из нескольких внешних колец — отдельные объёмы с одними тегами.
    outer.forEach((ring, i) => {
      const holes = inners.filter(hole => pointInRing(hole[0]!, ring))
      out.push({
        id: `${el.type}/${el.id}${outer.length > 1 ? `#${i + 1}` : ''}`,
        outer: ring, inners: holes, type: tags.building,
        name: tags.name || tags['name:ru'] || undefined,
        address: addressOf(tags),
        levels: h.levels, height: Math.round(h.height * 10) / 10, minHeight: h.minHeight, heightSource: h.source,
        roof: tags['roof:shape'] || undefined,
      })
    })
  }
  return out
}

/** Запрос Overpass: здания, у которых хоть одна точка в радиусе. */
export function overpassQuery(center: GeoPoint, radius: number): string {
  const around = `around:${Math.round(radius)},${center.lat.toFixed(6)},${center.lon.toFixed(6)}`
  return `[out:json][timeout:${Math.round(config.geoTimeoutMs / 1000)}];(way["building"](${around});relation["building"]["type"="multipolygon"](${around}););out body geom;`
}

export interface BuildingsResult { buildings: Building[]; source: string; tried: string[] }

/** Здания вокруг точки: зеркала Overpass по очереди, первое ответившее. */
export async function fetchBuildings(center: GeoPoint, radius: number, signal?: AbortSignal, fetcher: typeof fetchJson = fetchJson): Promise<BuildingsResult> {
  const query = overpassQuery(center, radius)
  const errors: string[] = []
  for (const url of config.overpassUrls) {
    try {
      const data = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(query)}` }, signal)
      const label = new URL(url).hostname
      return { buildings: parseOverpass(data), source: label, tried: errors }
    } catch (error) {
      if (signal?.aborted) throw error
      errors.push(`${new URL(url).hostname}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`Overpass недоступен: ${errors.join('; ')}.`)
}

interface DgisItem { point?: { lat: number; lon: number }; floors?: { ground_count?: number }; address_name?: string; name?: string }

/** Этажность из 2GIS: сопоставление по точке здания внутри контура OSM. */
export async function enrich2gis(buildings: Building[], center: GeoPoint, radius: number, key: string, signal?: AbortSignal, fetcher: typeof fetchJson = fetchJson): Promise<{ matched: number; total: number }> {
  let matched = 0, total = 0
  for (let page = 1; page <= 10; page++) {
    const url = `https://catalog.api.2gis.com/3.0/items?point=${center.lon.toFixed(6)},${center.lat.toFixed(6)}&radius=${Math.round(Math.min(radius, 3000))}&type=building&fields=items.point,items.floors,items.address_name&page_size=50&page=${page}&key=${encodeURIComponent(key)}`
    const data = await fetcher(url, {}, signal) as { result?: { items?: DgisItem[]; total?: number } }
    const items = data?.result?.items ?? []
    for (const item of items) {
      total++
      const floors = item.floors?.ground_count
      if (!item.point || !floors) continue
      const p: [number, number] = [item.point.lon, item.point.lat]
      const b = buildings.find(x => pointInRing(p, x.outer))
      if (!b) continue
      matched++
      if (b.heightSource === 'height') continue
      b.levels = floors
      b.height = Math.round(floors * levelHeight(b.type) * 10) / 10
      b.heightSource = '2gis'
      if (!b.address && item.address_name) b.address = item.address_name
    }
    if (items.length < 50) break
  }
  return { matched, total }
}
