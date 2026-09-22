/**
 * Точка на карте для массинга: из ссылки на карту, из пары координат или
 * по адресу через геокодер.
 *
 * Приоритет российским сервисам: Яндекс Геокодер и 2GIS работают по ключу
 * (YANDEX_GEOCODER_KEY, DGIS_KEY в .env); без ключей — Nominatim
 * OpenStreetMap. Ссылки Яндекс.Карт и 2GIS разбираются без сети вовсе:
 * координаты лежат прямо в адресе страницы, в том числе у панорам.
 */
import { config } from './config.ts'

export interface GeoPoint { lat: number; lon: number }

export interface Place extends GeoPoint {
  /** Как назвать место в модели и в ответе. */
  label: string
  /** Откуда взята точка: url, coordinates, yandex, 2gis, nominatim. */
  source: string
  /** Объект OSM, если геокодер его назвал (по нему подсвечивается здание). */
  osm?: { type: 'way' | 'relation' | 'node'; id: number }
}

const LAT = /^-?\d{1,2}(?:\.\d+)?$/
const NUM = String.raw`-?\d{1,3}(?:[.,]\d+)?`

function valid(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
}

function pair(a: string, b: string, order: 'latlon' | 'lonlat'): GeoPoint | null {
  const x = Number(a.replace(',', '.')), y = Number(b.replace(',', '.'))
  const [lat, lon] = order === 'latlon' ? [x, y] : [y, x]
  return valid(lat, lon) ? { lat, lon } : null
}

function safeDecode(text: string): string {
  try { return decodeURIComponent(text) } catch { return text }
}

/**
 * Координаты из текста: ссылка на карту или пара чисел. null — не нашли.
 *
 * Порядок в ссылках: Яндекс и 2GIS пишут «долгота,широта», Google и OSM —
 * «широта,долгота». В голой паре чисел считаем первым широту (так принято
 * в России: 55.74, 37.65); если первое число не может быть широтой —
 * меняем местами.
 */
export function parsePoint(text: string): GeoPoint | null {
  const raw = text.trim()
  if (!raw) return null
  const s = safeDecode(raw)
  const host = (s.match(/https?:\/\/([^/\s]+)/i)?.[1] ?? '').toLowerCase()
  const param = (name: string): [string, string] | null => {
    const m = s.match(new RegExp(String.raw`[?&#]${name}=(${NUM})[,\s;]+(${NUM})`, 'i'))
    return m ? [m[1]!, m[2]!] : null
  }
  if (/yandex|ya\.ru|yandex\.ru/.test(host)) {
    // Панорама: точка съёмки важнее центра карты (ll) — она там, где стоит камера.
    for (const name of ['panorama\\[point\\]', 'whatshere\\[point\\]', 'pt', 'll']) {
      const p = param(name); const r = p && pair(p[0], p[1], 'lonlat'); if (r) return r
    }
  }
  if (/2gis/.test(host)) {
    const p = param('m'); const r = p && pair(p[0], p[1], 'lonlat'); if (r) return r
  }
  if (/google|goo\.gl|maps\.app/.test(host)) {
    const at = s.match(new RegExp(String.raw`@(${NUM}),(${NUM})`)); if (at) { const r = pair(at[1]!, at[2]!, 'latlon'); if (r) return r }
    for (const name of ['q', 'query', 'll', 'center']) {
      const p = param(name); const r = p && pair(p[0], p[1], 'latlon'); if (r) return r
    }
  }
  if (/openstreetmap|osm\.org/.test(host)) {
    const map = s.match(new RegExp(String.raw`#map=\d+/(${NUM})/(${NUM})`)); if (map) { const r = pair(map[1]!, map[2]!, 'latlon'); if (r) return r }
    const mlat = s.match(new RegExp(String.raw`mlat=(${NUM})`)), mlon = s.match(new RegExp(String.raw`mlon=(${NUM})`))
    if (mlat && mlon) { const r = pair(mlat[1]!, mlon[1]!, 'latlon'); if (r) return r }
  }
  if (host) {
    // Неизвестная карта: любой параметр из пары чисел, порядок «долгота,широта» если первое не похоже на широту.
    const any = s.match(new RegExp(String.raw`[?&#][a-z_\[\]%]+=(${NUM})[,;](${NUM})`, 'i'))
    if (any) { const r = pair(any[1]!, any[2]!, LAT.test(any[1]!) && Math.abs(Number(any[1])) <= 90 && Math.abs(Number(any[2])) > 90 ? 'latlon' : 'lonlat') ?? pair(any[1]!, any[2]!, 'latlon'); if (r) return r }
    return null
  }
  // Голая пара: «55.743020, 37.650060», «55.743 37.650», «N55.74 E37.65».
  const m = s.match(new RegExp(String.raw`^[NnСс]?\s*(${NUM})\s*[°]?\s*[,;\s]\s*[EeВв]?\s*(${NUM})\s*[°]?$`))
  if (!m) return null
  const a = Number(m[1]!.replace(',', '.')), b = Number(m[2]!.replace(',', '.'))
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  // Запятая как десятичный разделитель («55,74 37,65») уже разобрана; «55, 37» без дробей — тоже широта/долгота.
  return Math.abs(a) > 90 && Math.abs(b) <= 90 ? (valid(b, a) ? { lat: b, lon: a } : null) : (valid(a, b) ? { lat: a, lon: b } : null)
}

/** Пара «широта, долгота» — как подпись места, когда адреса нет. */
export function pointLabel(p: GeoPoint): string {
  return `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`
}

export const USER_AGENT = 'stultus-gateway (SketchUp plugin; https://github.com/B-A-community/stultus)'

/** GET/POST JSON с таймаутом; ошибки сети и статусы — в понятный текст. */
export async function fetchJson(url: string, init: RequestInit & { timeoutMs?: number } = {}, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('таймаут')), init.timeoutMs ?? config.geoTimeoutMs)
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, headers: { 'user-agent': USER_AGENT, accept: 'application/json', 'accept-language': 'ru,en', ...(init.headers ?? {}) } })
    const text = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status}${text ? `: ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)}` : ''}`)
    try { return JSON.parse(text) } catch { throw new Error(`не JSON: ${text.slice(0, 120)}`) }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

type Fetch = typeof fetchJson

/** Яндекс Геокодер (ключ YANDEX_GEOCODER_KEY, бесплатный лимит на developer.tech.yandex.ru). */
export async function geocodeYandex(query: string, key: string, signal?: AbortSignal, fetcher: Fetch = fetchJson): Promise<Place | null> {
  const url = `https://geocode-maps.yandex.ru/1.x/?apikey=${encodeURIComponent(key)}&format=json&lang=ru_RU&results=1&geocode=${encodeURIComponent(query)}`
  const data = await fetcher(url, {}, signal) as { response?: { GeoObjectCollection?: { featureMember?: Array<{ GeoObject?: { Point?: { pos?: string }; metaDataProperty?: { GeocoderMetaData?: { text?: string } } } }> } } }
  const obj = data?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject
  const pos = obj?.Point?.pos?.split(/\s+/).map(Number)
  if (!pos || pos.length < 2) return null
  const p = pair(String(pos[0]), String(pos[1]), 'lonlat')
  return p ? { ...p, label: obj?.metaDataProperty?.GeocoderMetaData?.text || query, source: 'yandex' } : null
}

/** Геокодер 2GIS (ключ DGIS_KEY с dev.2gis.ru). */
export async function geocode2gis(query: string, key: string, signal?: AbortSignal, fetcher: Fetch = fetchJson): Promise<Place | null> {
  const url = `https://catalog.api.2gis.com/3.0/items/geocode?q=${encodeURIComponent(query)}&fields=items.point,items.full_name&key=${encodeURIComponent(key)}`
  const data = await fetcher(url, {}, signal) as { result?: { items?: Array<{ point?: { lat?: number; lon?: number }; full_name?: string; name?: string }> } }
  const item = data?.result?.items?.[0]
  if (!item?.point || !valid(Number(item.point.lat), Number(item.point.lon))) return null
  return { lat: Number(item.point.lat), lon: Number(item.point.lon), label: item.full_name || item.name || query, source: '2gis' }
}

/** Nominatim OpenStreetMap: без ключа, не чаще запроса в секунду, с User-Agent. */
export async function geocodeNominatim(query: string, signal?: AbortSignal, fetcher: Fetch = fetchJson): Promise<Place | null> {
  const url = `${config.nominatimUrl.replace(/\/$/, '')}/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`
  const data = await fetcher(url, {}, signal) as Array<{ lat?: string; lon?: string; display_name?: string; osm_type?: string; osm_id?: number }>
  const hit = Array.isArray(data) ? data[0] : undefined
  if (!hit) return null
  const p = pair(String(hit.lat), String(hit.lon), 'latlon')
  if (!p) return null
  const osmType = hit.osm_type === 'way' || hit.osm_type === 'relation' || hit.osm_type === 'node' ? hit.osm_type : undefined
  return { ...p, label: hit.display_name || query, source: 'nominatim', osm: osmType && hit.osm_id ? { type: osmType, id: hit.osm_id } : undefined }
}

/**
 * Место по тексту: ссылка/координаты — без сети; адрес — по цепочке
 * геокодеров (Яндекс → 2GIS → Nominatim, первые два только при ключах).
 */
export async function resolvePlace(text: string, signal?: AbortSignal, fetcher: Fetch = fetchJson): Promise<Place> {
  const query = text.trim()
  if (!query) throw new Error('Не указано место: адрес, координаты или ссылка на карту.')
  const point = parsePoint(query)
  if (point) return { ...point, label: pointLabel(point), source: /^https?:/i.test(query) ? 'url' : 'coordinates' }
  if (/^https?:/i.test(query)) throw new Error('В ссылке нет координат. Пришлите адрес или пару «широта, долгота».')
  const errors: string[] = []
  const attempts: Array<[string, () => Promise<Place | null>]> = []
  if (config.yandexGeocoderKey) attempts.push(['Яндекс', () => geocodeYandex(query, config.yandexGeocoderKey, signal, fetcher)])
  if (config.dgisKey) attempts.push(['2GIS', () => geocode2gis(query, config.dgisKey, signal, fetcher)])
  attempts.push(['Nominatim', () => geocodeNominatim(query, signal, fetcher)])
  for (const [name, run] of attempts) {
    try {
      const place = await run()
      if (place) return place
      errors.push(`${name}: адрес не найден`)
    } catch (error) {
      if (signal?.aborted) throw error
      errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`Место «${query}» не найдено. ${errors.join('; ')}.`)
}
