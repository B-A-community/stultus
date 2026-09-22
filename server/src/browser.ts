/**
 * Браузер на сервере: модель открывает страницу и работает с ней руками.
 *
 * Нужен там, где мало снимка с панорамы: походить по панораме стрелками,
 * покрутить обзор, посмотреть объект с разных сторон. Панорама Яндекса
 * рисуется через WebGL, поэтому Chromium запускается с программной
 * отрисовкой (SwiftShader) — видеокарта на сервере не нужна.
 *
 * Правила:
 *   — одно окно SketchUp = одна вкладка; браузер запускается по первой
 *     надобности и глушится, когда вкладок не осталось;
 *   — вкладка живёт BROWSER_IDLE_MS без обращений, потом закрывается:
 *     на сервере с двумя гигабайтами памяти забытая вкладка дорога;
 *   — Playwright подгружается динамически. Не установлен — инструмент
 *     честно говорит об этом, остальной gateway работает как работал;
 *   — баннеры согласия закрываются самым бережным вариантом: только
 *     необходимые файлы cookie.
 */
import { config } from './config.ts'

export type BrowseAction = 'open' | 'click' | 'drag' | 'key' | 'scroll' | 'shot' | 'close'

export interface BrowseCommand {
  action: BrowseAction
  url?: string
  x?: number
  y?: number
  dx?: number
  dy?: number
  key?: string
  /** Сколько ждать после действия, секунды: панораме нужно доехать. */
  wait?: number
}

export interface Shot {
  jpeg: Buffer
  url: string
  title: string
  /** Видимый текст страницы, обрезанный: подписи, кнопки, адреса. */
  text: string
  width: number
  height: number
}

export const VIEWPORT = { width: 1280, height: 800 }

interface Session {
  page: import('playwright').Page
  context: import('playwright').BrowserContext
  touched: number
  timer: NodeJS.Timeout | null
}

let browser: import('playwright').Browser | null = null
let launching: Promise<import('playwright').Browser> | null = null
const sessions = new Map<string, Session>()

/** Установлен ли Playwright на этой машине. */
export async function browserAvailable(): Promise<boolean> {
  try {
    await import('playwright')
    return true
  } catch {
    return false
  }
}

async function launch(): Promise<import('playwright').Browser> {
  if (browser?.isConnected()) return browser
  if (launching) return launching
  launching = (async () => {
    let chromium: typeof import('playwright').chromium
    try {
      ({ chromium } = await import('playwright'))
    } catch {
      throw new Error('Браузер на сервере не установлен: нужен Playwright с Chromium (npm i playwright && npx playwright install --with-deps chromium).')
    }
    const b = await chromium.launch({
      args: [
        // Программная отрисовка WebGL: без неё панорама остаётся чёрной.
        '--enable-unsafe-swiftshader', '--use-gl=swiftshader',
        '--disable-dev-shm-usage', '--no-sandbox', '--lang=ru-RU',
      ],
    })
    b.on('disconnected', () => { browser = null })
    browser = b
    return b
  })()
  try {
    return await launching
  } finally {
    launching = null
  }
}

function touch(id: string, s: Session): void {
  s.touched = Date.now()
  if (s.timer) clearTimeout(s.timer)
  s.timer = setTimeout(() => { void closeSession(id) }, config.browserIdleMs)
  s.timer.unref?.()
}

/** Закрыть вкладку окна; когда вкладок не осталось — и сам браузер. */
export async function closeSession(id: string): Promise<void> {
  const s = sessions.get(id)
  if (!s) return
  sessions.delete(id)
  if (s.timer) clearTimeout(s.timer)
  try { await s.context.close() } catch { /* уже закрыт */ }
  if (!sessions.size && browser) {
    const b = browser
    browser = null
    try { await b.close() } catch { /* уже закрыт */ }
  }
}

async function session(id: string): Promise<Session> {
  const existing = sessions.get(id)
  if (existing && !existing.page.isClosed()) { touch(id, existing); return existing }
  const b = await launch()
  const context = await b.newContext({
    viewport: VIEWPORT,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  page.setDefaultTimeout(config.browserTimeoutMs)
  const s: Session = { page, context, touched: Date.now(), timer: null }
  sessions.set(id, s)
  touch(id, s)
  return s
}

/** Баннер согласия: выбираем только необходимые cookie, не «принять всё». */
async function dismissConsent(page: import('playwright').Page): Promise<void> {
  const gentle = [
    'Allow essential cookies', 'Только необходимые', 'Принять необходимые',
    'Essential cookies only', 'Отклонить все', 'Reject all',
  ]
  for (const label of gentle) {
    try {
      const button = page.getByRole('button', { name: label, exact: false }).first()
      if (await button.isVisible({ timeout: 700 })) { await button.click({ timeout: 2000 }); return }
    } catch { /* этой кнопки нет — пробуем следующую */ }
  }
}

async function shot(page: import('playwright').Page): Promise<Shot> {
  const jpeg = await page.screenshot({ type: 'jpeg', quality: 78 })
  let text = ''
  try {
    text = String(await page.evaluate(() => document.body?.innerText ?? '')).replace(/\s+/g, ' ').trim().slice(0, 1200)
  } catch { /* страница могла уехать на навигацию */ }
  return { jpeg, url: page.url(), title: await page.title().catch(() => ''), text, ...VIEWPORT }
}

const KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'PageUp', 'PageDown', 'Home', 'End', 'Tab', 'Space', '+', '-'])

/**
 * Одно действие в браузере и снимок того, что получилось.
 *
 * Координаты — в пикселях снимка: модель видит ту же картинку, что и
 * кликает, поэтому попасть в стрелку панорамы можно прямо по снимку.
 */
export async function browse(id: string, cmd: BrowseCommand, signal?: AbortSignal): Promise<Shot> {
  if (cmd.action === 'close') { await closeSession(id); return { jpeg: Buffer.alloc(0), url: '', title: '', text: 'Вкладка закрыта.', ...VIEWPORT } }
  // Проверяем аргументы до запуска браузера: незачем поднимать Chromium ради ошибки.
  if (cmd.action === 'open' && !/^https?:\/\//i.test((cmd.url ?? '').trim())) throw new Error('Адрес должен начинаться с http:// или https://')
  if (cmd.action === 'key' && !KEYS.has((cmd.key ?? '').trim())) throw new Error(`Клавиша «${cmd.key ?? ''}» не поддерживается. Можно: ${[...KEYS].join(', ')}.`)
  const s = await session(id)
  const page = s.page
  const wait = Math.max(0, Math.min(20, cmd.wait ?? 2)) * 1000
  const px = (v: number | undefined, max: number) => Math.max(0, Math.min(max - 1, Math.round(v ?? max / 2)))

  switch (cmd.action) {
    case 'open': {
      const url = (cmd.url ?? '').trim()
      if (!/^https?:\/\//i.test(url)) throw new Error('Адрес должен начинаться с http:// или https://')
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.browserTimeoutMs })
      await page.waitForTimeout(Math.max(wait, 3000))
      await dismissConsent(page)
      break
    }
    case 'click': {
      await page.mouse.click(px(cmd.x, VIEWPORT.width), px(cmd.y, VIEWPORT.height))
      await page.waitForTimeout(wait)
      break
    }
    case 'drag': {
      const x = px(cmd.x, VIEWPORT.width), y = px(cmd.y, VIEWPORT.height)
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(px(x + (cmd.dx ?? 0), VIEWPORT.width), px(y + (cmd.dy ?? 0), VIEWPORT.height), { steps: 16 })
      await page.mouse.up()
      await page.waitForTimeout(wait)
      break
    }
    case 'key': {
      const key = (cmd.key ?? '').trim()
      if (!KEYS.has(key)) throw new Error(`Клавиша «${key}» не поддерживается. Можно: ${[...KEYS].join(', ')}.`)
      await page.keyboard.press(key === 'Space' ? ' ' : key)
      await page.waitForTimeout(wait)
      break
    }
    case 'scroll': {
      await page.mouse.move(px(cmd.x, VIEWPORT.width), px(cmd.y, VIEWPORT.height))
      await page.mouse.wheel(0, cmd.dy ?? 300)
      await page.waitForTimeout(wait)
      break
    }
    case 'shot':
      if (wait) await page.waitForTimeout(wait)
      break
  }
  signal?.throwIfAborted()
  return shot(page)
}

/** Сколько вкладок открыто — для проверки здоровья. */
export function openTabs(): number {
  return sessions.size
}
