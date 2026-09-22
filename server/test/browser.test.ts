import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VIEWPORT, browse, browserAvailable, closeSession, openTabs } from '../src/browser.ts'

test('размер окна браузера задан и разумен', () => {
  assert.equal(VIEWPORT.width, 1280)
  assert.equal(VIEWPORT.height, 800)
})

test('аргументы проверяются до запуска браузера', async () => {
  // Ни один из этих вызовов не должен поднимать Chromium: вкладок не прибавится.
  await assert.rejects(browse('test', { action: 'open', url: 'yandex.ru' }), /http:\/\/ или https:\/\//)
  await assert.rejects(browse('test', { action: 'open', url: 'file:///etc/passwd' }), /http:\/\/ или https:\/\//)
  await assert.rejects(browse('test', { action: 'open' }), /http:\/\/ или https:\/\//)
  await assert.rejects(browse('test', { action: 'key', key: 'F12' }), /не поддерживается/)
  await assert.rejects(browse('test', { action: 'key', key: '' }), /не поддерживается/)
  assert.equal(openTabs(), 0)
})

test('закрытие несуществующей вкладки молчит, close не поднимает браузер', async () => {
  await closeSession('нет такой')
  const r = await browse('нет такой', { action: 'close' })
  assert.equal(r.text, 'Вкладка закрыта.')
  assert.equal(r.jpeg.length, 0)
  assert.equal(openTabs(), 0)
})

test('доступность браузера определяется без падения', async () => {
  assert.equal(typeof (await browserAvailable()), 'boolean')
})
