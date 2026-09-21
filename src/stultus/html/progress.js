/* Оверлей хода генерации над лентой чата: лента темнеет, в центре сетка
   плиток кадра; готовые плитки заполняются своими миниатюрами, текущая
   мерцает. Для одиночной генерации — одна клетка и таймер. Клик по фону
   скрывает оверлей до конца этой генерации, сама генерация не трогается. */
window.StultusProgress = (function () {
  'use strict';
  function element(tag, name, text) { var el = document.createElement(tag); el.className = name; if (text) el.textContent = text; return el; }
  var el = null, current = null, hiddenFor = null, timer = null;
  function chatRect() { var chat = document.querySelector('.chat'); return chat ? chat.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }; }
  function place() { if (!el) return; var r = chatRect(); el.style.left = r.left + 'px'; el.style.top = r.top + 'px'; el.style.width = r.width + 'px'; el.style.height = r.height + 'px'; }
  function clock(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function build(id, p) {
    el = element('div', 'gen'); el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    var panel = element('div', 'gen__panel');
    var title = element('div', 'gen__title', ''), grid = element('div', 'gen__grid'), foot = element('div', 'gen__foot', ''), hint = element('div', 'gen__hint', 'клик по фону — скрыть');
    panel.appendChild(title); panel.appendChild(grid); panel.appendChild(foot); el.appendChild(panel); el.appendChild(hint);
    el.onclick = function (e) { if (e.target === el || e.target === hint) { hiddenFor = id; hide(); } };
    document.body.appendChild(el); place(); window.addEventListener('resize', place);
    current = { id: id, title: title, grid: grid, foot: foot, cells: [], started: Date.now(), cols: 0, rows: 0, done: 0, total: 1 };
    timer = setInterval(tick, 1000);
    layout(p);
  }
  function layout(p) {
    var g = p.grid || { cols: 1, rows: 1 };
    if (current.cols === g.cols && current.rows === g.rows && current.cells.length) return;
    current.cols = g.cols; current.rows = g.rows; current.cells = []; current.grid.innerHTML = '';
    var aspect = p.frame && p.frame.height ? p.frame.width / p.frame.height : 16 / 9;
    var maxW = Math.min(chatRect().width - 80, 520), cellW = Math.floor(maxW / g.cols), cellH = Math.floor(cellW / aspect * (g.cols / g.rows) * (g.rows / g.cols));
    current.grid.style.gridTemplateColumns = 'repeat(' + g.cols + ',' + cellW + 'px)';
    for (var i = 0; i < g.cols * g.rows; i++) {
      var c = element('div', 'gen__cell'); c.style.height = Math.max(40, Math.floor(cellW / aspect * g.cols / g.rows)) + 'px';
      current.grid.appendChild(c); current.cells.push(c);
    }
  }
  function tick() {
    if (!current) return;
    var elapsed = (Date.now() - current.started) / 1000;
    var per = current.done > 0 ? elapsed / current.done : 50, left = Math.max(0, (current.total - current.done) * per);
    current.foot.textContent = (current.total > 1 ? 'Готово ' + current.done + ' из ' + current.total + ' · ' : '') + 'прошло ' + clock(elapsed) + (current.done > 0 && current.done < current.total ? ' · осталось ≈ ' + clock(left) : current.done === 0 ? ' · обычно около минуты на генерацию' : '');
  }
  function update(id, p, text) {
    if (!p || hiddenFor === id) return;
    if (!current || current.id !== id) { hide(); build(id, p); }
    layout(p);
    current.done = p.done; current.total = p.total;
    current.title.textContent = text || '';
    var active = p.stage === 'tile' ? Math.max(0, p.done - 1) : p.stage === 'single' || p.stage === 'base' ? 0 : -1;
    if (p.stage === 'tile' && p.tile) active = -1;
    current.cells.forEach(function (c, i) { c.classList.toggle('is-active', i === active && p.stage !== 'stitch' && p.stage !== 'compose'); });
    if (p.tile && current.cells[p.tile.index]) {
      var cell = current.cells[p.tile.index]; cell.classList.add('is-done'); cell.classList.remove('is-active');
      if (p.tile.thumb && !cell.firstChild) { var im = document.createElement('img'); im.src = 'data:image/jpeg;base64,' + p.tile.thumb; im.alt = ''; cell.appendChild(im); }
      // Следующая плитка — в работе.
      var nxt = current.cells[p.tile.index + 1]; if (nxt && !nxt.classList.contains('is-done') && p.done < p.total) nxt.classList.add('is-active');
    }
    if (p.stage === 'base' || p.stage === 'single') current.cells.forEach(function (c) { c.classList.add('is-active'); });
    if (p.stage === 'stitch' || p.stage === 'compose') { current.cells.forEach(function (c) { c.classList.remove('is-active'); c.classList.add('is-done'); }); }
    tick();
  }
  function hide() {
    if (timer) { clearInterval(timer); timer = null; }
    if (el) { el.remove(); el = null; }
    window.removeEventListener('resize', place);
    current = null;
  }
  function done(id) { if (current && current.id === id) hide(); if (hiddenFor === id) hiddenFor = null; }
  return { update: update, done: done, hide: hide };
})();
