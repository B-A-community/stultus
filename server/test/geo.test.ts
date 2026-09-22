import { test } from 'node:test'
import assert from 'node:assert/strict'
import { geocodeNominatim, parsePoint, resolvePlace } from '../src/geo.ts'
import { assembleRings, enrich2gis, fetchBuildings, heightFromTags, overpassQuery, parseLength, parseOverpass, pointInRing } from '../src/buildings.ts'
import { cleanRing, collectMassing, inferByNeighbours, median, project, summarize, toMassing, type MassingBuilding } from '../src/massing.ts'
import type { Place } from '../src/geo.ts'

const YANDEX_PANORAMA = 'https://yandex.ru/maps/213/moscow/house/goncharnaya_ulitsa_26k1/Z04YcANpSEYOQFtvfXt1c3VjYA==/?l=stv%2Csta&ll=37.650060%2C55.743020&panorama%5Bdirection%5D=156.464938%2C0.000000&panorama%5Bfull%5D=true&panorama%5Bpoint%5D=37.649358%2C55.743140&panorama%5Bspan%5D=114.574557%2C60.000000&z=18.92'

test('parsePoint: ссылки на карты и голые координаты', () => {
  // Яндекс: у панорамы — точка съёмки, у обычной ссылки — центр ll; порядок долгота,широта.
  assert.deepEqual(parsePoint(YANDEX_PANORAMA), { lat: 55.74314, lon: 37.649358 })
  assert.deepEqual(parsePoint('https://yandex.ru/maps/?ll=37.650060%2C55.743020&z=17'), { lat: 55.74302, lon: 37.65006 })
  assert.deepEqual(parsePoint('https://2gis.ru/moscow/geo/4504235282682765?m=37.650060%2C55.743020%2F17.5'), { lat: 55.74302, lon: 37.65006 })
  assert.deepEqual(parsePoint('https://www.google.com/maps/@55.743020,37.650060,17z'), { lat: 55.74302, lon: 37.65006 })
  assert.deepEqual(parsePoint('https://www.google.com/maps?q=55.743020,37.650060'), { lat: 55.74302, lon: 37.65006 })
  assert.deepEqual(parsePoint('https://www.openstreetmap.org/#map=18/55.743020/37.650060'), { lat: 55.74302, lon: 37.65006 })
  assert.deepEqual(parsePoint('55.743020, 37.650060'), { lat: 55.74302, lon: 37.65006 })
  assert.deepEqual(parsePoint('55,743020 37,650060'), { lat: 55.74302, lon: 37.65006 })
  // Долгота первой — если первое число не может быть широтой.
  assert.deepEqual(parsePoint('137.5, 35.6'), { lat: 35.6, lon: 137.5 })
  assert.equal(parsePoint('Москва, Гончарная 26к1'), null)
  assert.equal(parsePoint('https://yandex.ru/maps/213/moscow/'), null)
})

test('resolvePlace: ссылка без сети, адрес через геокодер, ошибки внятные', async () => {
  const p = await resolvePlace(YANDEX_PANORAMA)
  assert.equal(p.source, 'url'); assert.equal(p.label, '55.74314, 37.64936')
  const nominatim = [{ lat: '55.7429091', lon: '37.6491746', display_name: '26 к1, Гончарная улица, Москва', osm_type: 'relation', osm_id: 15701003 }]
  const calls: string[] = []
  const fake = async (url: string) => { calls.push(url); return nominatim }
  const place = await resolvePlace('Гончарная 26к1, Москва', undefined, fake as never)
  assert.equal(place.source, 'nominatim'); assert.deepEqual(place.osm, { type: 'relation', id: 15701003 }); assert.ok(calls[0]!.includes('nominatim'))
  await assert.rejects(resolvePlace('Нигде', undefined, (async () => []) as never), /не найдено/)
  await assert.rejects(resolvePlace('https://yandex.ru/maps/213/moscow/'), /нет координат/)
  assert.equal(await geocodeNominatim('x', undefined, (async () => []) as never), null)
})

test('высота из тегов: height, этажность, оценка, единицы', () => {
  assert.equal(parseLength('12 m'), 12); assert.equal(parseLength('12,5'), 12.5); assert.equal(parseLength('40 ft'), 12.192); assert.equal(parseLength('высокий'), undefined)
  assert.deepEqual(heightFromTags({ building: 'apartments', height: '31', 'building:levels': '9' }), { height: 31, levels: 9, minHeight: undefined, source: 'height' })
  assert.deepEqual(heightFromTags({ building: 'apartments', 'building:levels': '9' }), { height: 27, levels: 9, minHeight: undefined, source: 'levels' })
  assert.deepEqual(heightFromTags({ building: 'office', 'building:levels': '2', 'roof:levels': '1' }), { height: 10.8, levels: 2, minHeight: undefined, source: 'levels' })
  const est = heightFromTags({ building: 'yes' }); assert.equal(est.source, 'estimate'); assert.equal(est.levels, 3)
  assert.equal(heightFromTags({ building: 'garage' }).height, 3.2)
  assert.equal(heightFromTags({ building: 'bridge', 'building:levels': '1', min_height: '5' }).minHeight, 5)
})

test('кольца: сборка из кусков, точка в кольце', () => {
  const a: Array<[number, number]> = [[0, 0], [1, 0]], b: Array<[number, number]> = [[1, 1], [1, 0]], c: Array<[number, number]> = [[1, 1], [0, 1], [0, 0]]
  const rings = assembleRings([a, b, c])
  assert.equal(rings.length, 1); assert.equal(rings[0]!.length, 4)
  assert.ok(pointInRing([0.5, 0.5], rings[0]!)); assert.ok(!pointInRing([1.5, 0.5], rings[0]!))
  // Незамкнутый обрывок — не кольцо.
  assert.equal(assembleRings([[[0, 0], [1, 0]]]).length, 0)
})

const OVERPASS = {
  elements: [
    { type: 'way', id: 1, tags: { building: 'office', 'building:levels': '2', 'addr:street': 'Верхняя Радищевская улица', 'addr:housenumber': '11 с1' },
      geometry: [{ lat: 55.7442, lon: 37.6504 }, { lat: 55.7439, lon: 37.6511 }, { lat: 55.7438, lon: 37.6510 }, { lat: 55.7441, lon: 37.6502 }, { lat: 55.7442, lon: 37.6504 }] },
    { type: 'relation', id: 15701003, tags: { building: 'apartments', 'building:levels': '8', type: 'multipolygon', name: 'Дом' }, members: [
      { type: 'way', ref: 10, role: 'outer', geometry: [{ lat: 55.7422, lon: 37.6484 }, { lat: 55.7422, lon: 37.6498 }] },
      { type: 'way', ref: 11, role: 'outer', geometry: [{ lat: 55.7422, lon: 37.6498 }, { lat: 55.7436, lon: 37.6498 }, { lat: 55.7436, lon: 37.6484 }, { lat: 55.7422, lon: 37.6484 }] },
      { type: 'way', ref: 12, role: 'inner', geometry: [{ lat: 55.7426, lon: 37.6488 }, { lat: 55.7426, lon: 37.6494 }, { lat: 55.7432, lon: 37.6494 }, { lat: 55.7432, lon: 37.6488 }, { lat: 55.7426, lon: 37.6488 }] },
    ] },
    // Вырожденный: стороны около метра, пятно меньше 4 м².
    { type: 'way', id: 3, tags: { building: 'yes' }, geometry: [{ lat: 55.7430, lon: 37.6520 }, { lat: 55.7430, lon: 37.65201 }, { lat: 55.74301, lon: 37.65201 }, { lat: 55.7430, lon: 37.6520 }] },
    { type: 'way', id: 4, tags: { highway: 'residential' }, geometry: [{ lat: 55.7, lon: 37.6 }, { lat: 55.71, lon: 37.61 }] },
    { type: 'way', id: 5, tags: { building: 'shed' }, geometry: [{ lat: 55.7430, lon: 37.6520 }, { lat: 55.7430, lon: 37.6521 }] },
  ],
}

test('parseOverpass: линии и мультиполигоны с дырами, без не-зданий', () => {
  const list = parseOverpass(OVERPASS)
  assert.deepEqual(list.map(b => b.id), ['way/1', 'relation/15701003', 'way/3'])
  const house = list[1]!
  assert.equal(house.outer.length, 4); assert.equal(house.inners.length, 1); assert.equal(house.height, 24); assert.equal(house.heightSource, 'levels'); assert.equal(house.name, 'Дом')
  assert.equal(list[0]!.address, 'Верхняя Радищевская улица, 11 с1')
  assert.equal(list[2]!.heightSource, 'estimate')
  assert.match(overpassQuery({ lat: 55.743, lon: 37.65 }, 250), /around:250,55\.743000,37\.650000/)
})

test('fetchBuildings: первое живое зеркало, ошибки остальных — в отчёт', async () => {
  const tried: string[] = []
  const fake = async (url: string) => { tried.push(url); if (url.includes('mail.ru')) throw new Error('HTTP 504'); return OVERPASS }
  const r = await fetchBuildings({ lat: 55.743, lon: 37.65 }, 250, undefined, fake as never)
  assert.equal(r.buildings.length, 3); assert.equal(r.source, 'overpass-api.de'); assert.equal(r.tried.length, 1); assert.ok(r.tried[0]!.includes('mail.ru'))
  await assert.rejects(fetchBuildings({ lat: 55.743, lon: 37.65 }, 250, undefined, (async () => { throw new Error('x') }) as never), /Overpass недоступен/)
})

test('массинг: проекция в метры, чистка колец, целевое здание, сводка', () => {
  const place: Place = { lat: 55.7429, lon: 37.6491, label: 'Гончарная 26к1', source: 'nominatim', osm: { type: 'relation', id: 15701003 } }
  const east = project(place, [[37.6491 + 0.001, 55.7429]])[0]!
  assert.ok(Math.abs(east[0] - 62.6) < 0.5 && Math.abs(east[1]) < 0.01, JSON.stringify(east))
  const north = project(place, [[37.6491, 55.7429 + 0.001]])[0]!
  assert.ok(Math.abs(north[1] - 111.3) < 0.1)
  // Чистка: дубли и обход по часовой → против.
  assert.deepEqual(cleanRing([[0, 0], [0, 0.01], [0, 10], [10, 10], [10, 0], [10, 0]]), [[10, 0], [10, 10], [0, 10], [0, 0]])
  const { buildings, skipped } = toMassing(place, 250, parseOverpass(OVERPASS))
  assert.equal(skipped, 1, 'вырожденный треугольник way/3 отброшен')
  assert.equal(buildings[0]!.id, 'relation/15701003'); assert.equal(buildings[0]!.target, true); assert.equal(buildings[0]!.inners.length, 1)
  assert.ok(buildings[0]!.area > 5000 && buildings[0]!.area < 20000, String(buildings[0]!.area))
  const text = summarize({ place, radius: 250, buildings, sources: ['maps.mail.ru'], stats: { total: 2, byHeight: { height: 0, levels: 2, '2gis': 0, estimate: 0 }, skipped } })
  assert.match(text, /Зданий: 2/); assert.match(text, /ЭТО ЗАПРОШЕННЫЙ АДРЕС/); assert.match(text, /8 эт\., 24 м/)
})

test('collectMassing: сквозной путь по ссылке с подменённой сетью', async () => {
  const fake = async (url: string) => { assert.ok(url.includes('interpreter')); return OVERPASS }
  const m = await collectMassing('https://yandex.ru/maps/?ll=37.6491%2C55.7429', 200, undefined, fake as never)
  assert.equal(m.place.source, 'url'); assert.equal(m.buildings.length, 2); assert.equal(m.stats.byHeight.levels, 2); assert.equal(m.sources[0], 'maps.mail.ru')
})

test('enrich2gis: этажность подставляется по точке внутри контура, тег height не перебивается', async () => {
  const list = parseOverpass(OVERPASS)
  list[0]!.heightSource = 'estimate'
  const dgis = { result: { items: [
    { point: { lat: 55.74405, lon: 37.65065 }, floors: { ground_count: 5 }, address_name: 'Верхняя Радищевская, 11' },
    { point: { lat: 55.7429, lon: 37.6486 }, floors: { ground_count: 12 } },
    { point: { lat: 55.9, lon: 37.9 }, floors: { ground_count: 3 } },
  ] } }
  const r = await enrich2gis(list, { lat: 55.743, lon: 37.65 }, 250, 'key', undefined, (async () => dgis) as never)
  assert.deepEqual(r, { matched: 2, total: 3 })
  assert.equal(list[0]!.levels, 5); assert.equal(list[0]!.heightSource, '2gis'); assert.equal(list[0]!.height, 18)
  assert.equal(list[1]!.levels, 12)
})

/** Здание для проверки подбора по соседям: квадрат со стороной по площади. */
function box(id: string, x: number, y: number, side: number, type: string, height: number, source: 'levels' | 'estimate'): MassingBuilding {
  const h = side / 2
  return {
    id, type, height, heightSource: source, levels: source === 'levels' ? Math.round(height / 3) : undefined,
    outer: [[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]], inners: [],
    area: side * side, distance: Math.round(Math.hypot(x, y)),
  }
}

test('median: чётное и нечётное число значений', () => {
  assert.equal(median([9]), 9); assert.equal(median([3, 1, 2]), 2); assert.equal(median([4, 1, 3, 2]), 2.5)
})

test('высота по соседям: берётся медиана похожих, хозпостройки и одиночки не трогаются', () => {
  const list = [
    box('way/1', 0, 0, 30, 'apartments', 27, 'levels'),
    box('way/2', 40, 0, 30, 'apartments', 30, 'levels'),
    box('way/3', 0, 40, 30, 'apartments', 24, 'levels'),
    // Без данных, рядом с тремя жилыми того же размера → медиана 27.
    box('way/4', 20, 20, 30, 'apartments', 15, 'estimate'),
    // Гараж рядом с ними остаётся одноэтажным.
    box('way/5', 25, 25, 6, 'garage', 3.2, 'estimate'),
    // Офис: соседей того же типа нет → остаётся оценкой по типу.
    box('way/6', 10, 10, 20, 'office', 14.4, 'estimate'),
    // Далеко (600 м) от жилых → соседей в радиусе нет.
    box('way/7', 600, 600, 30, 'apartments', 15, 'estimate'),
  ]
  const changed = inferByNeighbours(list, 200)
  assert.equal(changed, 1)
  const [four, garage, office, far] = [list[3]!, list[4]!, list[5]!, list[6]!]
  assert.equal(four.height, 27); assert.equal(four.heightSource, 'neighbours'); assert.equal(four.levels, 9)
  assert.equal(garage.heightSource, 'estimate'); assert.equal(garage.height, 3.2)
  assert.equal(office.heightSource, 'estimate')
  assert.equal(far.heightSource, 'estimate')
  // Известных соседей меньше порога — ничего не меняем.
  assert.equal(inferByNeighbours([box('way/8', 0, 0, 30, 'apartments', 15, 'estimate')], 200), 0)
})

test('подбор по соседям пропускает здания несопоставимого пятна, если похожих хватает', () => {
  const list = [
    box('way/1', 0, 0, 40, 'retail', 16, 'levels'),
    box('way/2', 30, 0, 40, 'retail', 20, 'levels'),
    box('way/3', 0, 30, 6, 'retail', 4, 'levels'),
    box('way/4', 15, 15, 5, 'retail', 8, 'estimate'),
  ]
  inferByNeighbours(list, 200)
  // Для мелкого павильона похожих по площади нет (минимум два), поэтому берётся медиана всех retail: 16.
  assert.equal(list[3]!.heightSource, 'neighbours')
  assert.equal(list[3]!.height, 16)
})
