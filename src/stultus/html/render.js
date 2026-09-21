/* Postproduction cards. No network or credentials here; all work goes through gateway. */
window.StultusRender = function (api) {
  'use strict';
  var jobs = {};
  function imageUrl(base64) { return 'data:image/png;base64,' + base64; }
  function element(tag, name, text) { var el = document.createElement(tag); el.className = name; if (text) el.textContent = text; return el; }
  // Миниатюра по клику раскрывается на всё окно; клик или Escape закрывает.
  var lightbox = null;
  // Просмотр крупно: колесо — масштаб вокруг курсора (до ×8), средняя или
  // правая кнопка — сдвиг, двойной клик — ×2/×1, клик по фону или Esc — закрыть.
  var lightboxZoom = null;
  function openLightbox(src, alt) {
    closeLightbox();
    lightbox = element('div', 'lightbox');
    lightbox.setAttribute('role', 'dialog');
    lightbox.setAttribute('aria-label', alt || 'Изображение');
    var stage = element('div', 'lightbox__stage'), frame = element('div', 'lightbox__frame');
    var img = element('img', 'lightbox__image'); img.src = src; img.alt = alt || ''; img.draggable = false;
    var hint = element('div', 'lightbox__hint', 'Колесо — масштаб · средняя или правая кнопка — сдвиг · клик по фону или Esc — закрыть');
    frame.appendChild(img); stage.appendChild(frame); lightbox.appendChild(stage); lightbox.appendChild(hint);
    var scale = 1, tx = 0, ty = 0, panning = null;
    function apply() { frame.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')'; hint.textContent = (scale > 1 ? '×' + scale.toFixed(1) + ' · ' : '') + 'Колесо — масштаб · средняя или правая кнопка — сдвиг · клик по фону или Esc — закрыть'; }
    function setZoom(next, cx, cy) {
      next = Math.max(1, Math.min(8, next));
      var r = stage.getBoundingClientRect(), fx = cx - r.left - r.width / 2, fy = cy - r.top - r.height / 2;
      var px = (fx - tx) / scale, py = (fy - ty) / scale;
      scale = next; tx = fx - px * scale; ty = fy - py * scale;
      if (scale === 1) { tx = 0; ty = 0; }
      apply();
    }
    lightboxZoom = { inc: function () { var r = stage.getBoundingClientRect(); setZoom(scale * 1.25, r.left + r.width / 2, r.top + r.height / 2); }, dec: function () { var r = stage.getBoundingClientRect(); setZoom(scale / 1.25, r.left + r.width / 2, r.top + r.height / 2); }, reset: function () { setZoom(1, 0, 0); } };
    stage.onwheel = function (e) { e.preventDefault(); setZoom(scale * Math.pow(1.15, -e.deltaY / 100), e.clientX, e.clientY); };
    stage.onpointerdown = function (e) {
      if (e.button === 1 || e.button === 2) { panning = { x: e.clientX - tx, y: e.clientY - ty }; stage.setPointerCapture(e.pointerId); e.preventDefault(); }
    };
    stage.onpointermove = function (e) { if (panning) { tx = e.clientX - panning.x; ty = e.clientY - panning.y; apply(); } };
    stage.onpointerup = stage.onpointercancel = function () { panning = null; };
    stage.oncontextmenu = function (e) { e.preventDefault(); };
    img.ondblclick = function (e) { e.stopPropagation(); setZoom(scale > 1 ? 1 : 2, e.clientX, e.clientY); };
    img.onclick = function (e) { e.stopPropagation(); };
    frame.onclick = function (e) { e.stopPropagation(); };
    stage.onclick = function (e) { if (e.target === stage) closeLightbox(); };
    hint.onclick = closeLightbox;
    lightbox.onclick = function (e) { if (e.target === lightbox) closeLightbox(); };
    document.body.appendChild(lightbox);
    document.addEventListener('keydown', onLightboxKey);
  }
  function closeLightbox() {
    if (!lightbox) return;
    lightbox.remove(); lightbox = null; lightboxZoom = null;
    document.removeEventListener('keydown', onLightboxKey);
  }
  function onLightboxKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); }
    else if (lightboxZoom && (e.key === '+' || e.key === '=')) { e.preventDefault(); lightboxZoom.inc(); }
    else if (lightboxZoom && e.key === '-') { e.preventDefault(); lightboxZoom.dec(); }
    else if (lightboxZoom && e.key === '0') { e.preventDefault(); lightboxZoom.reset(); }
  }
  window.StultusLightbox = openLightbox;
  function zoomable(img) {
    img.classList.add('is-zoomable');
    img.title = 'Открыть крупно';
    img.onclick = function () { if (img.src && !img.hidden) openLightbox(img.src, img.alt); };
  }
  // Сила задания: 0–100 → градация формулировок на сервере; здесь только подпись.
  var TIERS = [[20, 'минимум: только свет и материалы как нарисовано'], [45, 'сдержанно: без новых объектов'], [70, 'обычно'], [90, 'смело: свободная среда и материалы'], [100, 'максимум: концепт-арт']];
  function tierText(v) { for (var i = 0; i < TIERS.length; i++) if (v <= TIERS[i][0]) return TIERS[i][1]; return TIERS[TIERS.length - 1][1]; }
  function strengthControl(initial) {
    var wrap = element('label', 'card__option card__strength');
    wrap.appendChild(document.createTextNode('Влияние задания '));
    var range = document.createElement('input'); range.type = 'range'; range.min = 0; range.max = 100; range.value = initial == null ? 60 : initial; range.setAttribute('aria-label', 'Влияние задания');
    var out = element('span', 'card__strength-value', '');
    function update() { out.textContent = range.value + ' · ' + tierText(Number(range.value)); }
    range.oninput = update; update();
    wrap.appendChild(range); wrap.appendChild(out);
    return { el: wrap, value: function () { return Number(range.value); }, disable: function () { range.disabled = true; } };
  }
  function stripPrefix(dataUrl) { return String(dataUrl || '').replace(/^data:image\/\w+;base64,/, ''); }
  // Референсы стиля («Добавить вид…»): до 10 картинок, каждая → PNG не шире
  // 1600 px, миниатюры с крестиком. Генератор берёт из них стиль, не объекты.
  var MAX_REFERENCES = 10;
  function referenceControl() {
    var wrap = element('div', 'card__option card__reference');
    var input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.multiple = true; input.hidden = true;
    var pick = element('button', 'btn', 'Добавить вид…'), list = element('div', 'card__reference-list'), count = element('span', 'card__option-hint', '');
    var items = [];
    function render() {
      list.innerHTML = '';
      items.forEach(function (it, i) {
        var cell = element('span', 'card__reference-item');
        var thumb = element('img', 'card__reference-thumb'); thumb.src = it.data; thumb.alt = it.name; thumb.title = it.name;
        var drop = element('button', 'card__reference-drop', '×'); drop.title = 'Убрать ' + it.name; drop.setAttribute('aria-label', 'Убрать ' + it.name);
        drop.onclick = function () { items.splice(i, 1); render(); };
        cell.appendChild(thumb); cell.appendChild(drop); list.appendChild(cell);
      });
      count.textContent = items.length ? 'Видов: ' + items.length + ' из ' + MAX_REFERENCES + '. Генератор берёт из них свет, материалы и атмосферу, не объекты.' : '';
      pick.disabled = items.length >= MAX_REFERENCES;
      list.hidden = !items.length;
    }
    function add(file) {
      if (items.length >= MAX_REFERENCES) return;
      var reader = new FileReader();
      reader.onload = function () {
        var im = new Image();
        im.onload = function () {
          if (items.length >= MAX_REFERENCES) return;
          var k = Math.min(1, 1600 / im.naturalWidth), c = document.createElement('canvas');
          c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          items.push({ name: file.name, data: c.toDataURL('image/png') }); render();
        };
        im.src = reader.result;
      };
      reader.readAsDataURL(file);
    }
    pick.onclick = function () { input.click(); };
    input.onchange = function () { [].slice.call(input.files || []).slice(0, MAX_REFERENCES - items.length).forEach(add); input.value = ''; };
    wrap.appendChild(input); wrap.appendChild(pick); wrap.appendChild(count); wrap.appendChild(list);
    render();
    return { el: wrap, value: function () { return items.length ? items.map(function (it) { return stripPrefix(it.data); }) : null; }, disable: function () { pick.disabled = true; } };
  }
  function status(msg) {
    var job = jobs[msg.id]; if (!job) return;
    job.card.querySelector('.card__text').textContent = msg.text;
    if (msg.failed) {
      job.record.ok = false; job.card.classList.add('is-failed', 'is-done'); delete jobs[msg.id];
      if (job.waiting) { job.waiting = false; api.attended(); }
      if (job.stopButton) job.stopButton.remove();
    }
  }
  function request(msg, record) {
    var id = msg.args.render_id;
    var card = document.getElementById('tplShot').content.firstElementChild.cloneNode(true);
    card.classList.add('card--render');
    card.querySelector('.card__title').textContent = 'Создать визуализацию этого вида?';
    var NOTE = 'Текущий кадр будет передан генератору Codex. Используются лимиты вашей подписки. Камера и модель останутся прежними.';
    var text = card.querySelector('.card__text');
    text.textContent = msg.args.prompt + (msg.args.save_path ? '\n\nСохранить в: ' + msg.args.save_path : '') + '\n\n' + NOTE;
    var allow = card.querySelector('[data-act=allow]'), deny = card.querySelector('[data-act=deny]');
    allow.textContent = 'Зафиксировать и создать ↗'; deny.textContent = 'Отмена';
    // «Изменить» — между «создать» и «отмена»: задание открывается в поле
    // ввода прямо в карточке, и на генерацию уходит то, что написал человек.
    var edit = element('button', 'btn', 'Изменить');
    edit.setAttribute('data-act', 'edit');
    allow.insertAdjacentElement('afterend', edit);
    // Размер: обычный или «большой кадр» 4K/6K/8K — снимок в заданную ширину,
    // сборка из плиток на gateway. Честно пишем цену: генерации и минуты.
    var sizes = msg.args.sizes || [{ id: '4k', label: '4K', width: 3840, generations: 7 }];
    var option = element('label', 'card__option');
    option.appendChild(document.createTextNode('Размер '));
    var select = document.createElement('select'); select.className = 'card__select';
    var normal = document.createElement('option'); normal.value = 'normal'; normal.textContent = 'обычный, около минуты'; select.appendChild(normal);
    sizes.forEach(function (s) {
      var o = document.createElement('option'); o.value = s.id;
      o.textContent = s.label + ' · ' + s.width + ' px · ' + s.generations + ' генераций, ~' + Math.round(s.generations * 0.8) + ' мин';
      select.appendChild(o);
    });
    var wanted = msg.args.size === 'large' ? '4k' : msg.args.size;
    if (wanted && sizes.some(function (s) { return s.id === wanted; })) select.value = wanted;
    option.appendChild(select);
    var hint = element('span', 'card__option-hint', 'Большие кадры собираются из плиток, у стыков возможны артефакты.');
    option.appendChild(hint);
    text.insertAdjacentElement('afterend', option);
    // Область: снимок фиксируется сразу, на нём рисуется маска. Меняется только
    // закрашенное, остальное остаётся пиксель в пиксель. Камеру не двигать.
    var strength = strengthControl(60), reference = referenceControl();
    var region = element('div', 'card__option card__region');
    var regionBtn = element('button', 'btn', 'Область…'), regionInfo = element('span', 'card__option-hint', ''), regionDrop = element('button', 'btn', '×');
    regionDrop.hidden = true; regionDrop.title = 'Убрать область';
    region.appendChild(regionBtn); region.appendChild(regionDrop); region.appendChild(regionInfo);
    var mask = null, maskFrame = null;
    regionBtn.onclick = function () {
      regionBtn.disabled = true;
      api.rb('screenshot', { framing: 'viewport' }).then(function (r) {
        regionBtn.disabled = false;
        if (!r || !r.ok) { regionInfo.textContent = 'Снимок не получен: ' + (r && r.error); return; }
        maskFrame = r;
        window.StultusMask.open({ src: imageUrl(r.base64), initial: mask, onDone: function (dataUrl, pct) {
          mask = dataUrl; regionDrop.hidden = false;
          regionInfo.textContent = 'Область задана: ' + pct + '% кадра. Камеру не двигайте до запуска.';
        } });
      }).catch(function (e) { regionBtn.disabled = false; regionInfo.textContent = e.message; });
    };
    regionDrop.onclick = function () { mask = null; regionDrop.hidden = true; regionInfo.textContent = ''; };
    option.insertAdjacentElement('afterend', region);
    region.insertAdjacentElement('afterend', reference.el);
    reference.el.insertAdjacentElement('afterend', strength.el);
    var editor = null;
    edit.onclick = function () {
      if (jobs[id] !== job || editor) return;
      editor = element('textarea', 'card__editor');
      editor.value = msg.args.prompt;
      editor.rows = 6;
      editor.setAttribute('aria-label', 'Задание для визуализации');
      text.textContent = NOTE;
      text.insertAdjacentElement('beforebegin', editor);
      edit.hidden = true;
      editor.focus();
      api.scroll();
    };
    var job = jobs[id] = { card: card, record: record, source: null, waiting: true };
    api.attention();
    function chosenPrompt() {
      var v = editor ? editor.value.trim() : '';
      return v || msg.args.prompt;
    }
    allow.onclick = function () {
      if (jobs[id] !== job) return;
      var prompt = chosenPrompt();
      job.waiting = false; api.attended();
      var size = select.value, chosen = null;
      sizes.forEach(function (s) { if (s.id === size) chosen = s; });
      var large = !!chosen, largeWidth = chosen ? chosen.width : 0;
      allow.disabled = deny.disabled = edit.disabled = select.disabled = true;
      if (editor) { editor.remove(); editor = null; }
      edit.hidden = true; option.remove();
      var extras = { strength: strength.value(), references: reference.value(), mask: mask ? stripPrefix(mask) : null };
      job.extras = extras;
      region.remove(); reference.el.remove(); strength.el.remove();
      card.querySelector('.card__text').textContent = large ? 'Фиксирую текущий кадр в ' + largeWidth + ' px…' : 'Фиксирую текущий кадр…';
      api.rb('screenshot', large ? { framing: 'viewport', width: largeWidth } : { framing: 'viewport' }).then(function (r) {
        if (jobs[id] !== job) return;
        if (!r || !r.ok) throw new Error(r && r.error || 'Снимок не получен.');
        job.source = r.base64; job.camera = r.camera; job.capture = { width: r.width, height: r.height };
        var preview = card.querySelector('.card__preview'); preview.src = imageUrl(r.base64); preview.hidden = false; zoomable(preview);
        card.classList.add('is-done');
        card.querySelector('.card__title').textContent = 'Кадр зафиксирован';
        var tail = (extras.mask ? ' · только область' : '') + (extras.references ? ' · видов: ' + extras.references.length : '') + ' · влияние ' + extras.strength;
        card.querySelector('.card__text').textContent = r.width + ' × ' + r.height + (large ? ' · большой кадр, собираю из плиток…' : ' · создаю визуализацию…') + tail + '\n\nЗадание: ' + prompt;
        var edited = prompt !== msg.args.prompt;
        api.send({ type: 'tool_result', call_id: msg.call_id, ok: true,
          content: (edited ? 'Точный кадр вьюпорта разрешён для постпродакшна. Пользователь изменил задание, в генерацию уходит его текст.' : 'Точный кадр вьюпорта разрешён для постпродакшна.') + (large ? ' Пользователь выбрал большой кадр.' : '') + (extras.mask ? ' Пользователь отметил область: меняется только она.' : '') + (extras.references ? ' Приложены референсы стиля: ' + extras.references.length + '.' : ''),
          image: { mime: r.mime, base64: r.base64 }, capture: { framing: r.framing, width: r.width, height: r.height }, prompt: prompt, size: large ? size : 'normal',
          mask: extras.mask || undefined, references: extras.references || undefined, strength: extras.strength });
        api.scroll();
      }).catch(function (error) {
        if (jobs[id] !== job) return;
        status({ id: id, text: error.message, failed: true });
        api.send({ type: 'tool_result', call_id: msg.call_id, ok: false, content: error.message });
      });
    };
    deny.onclick = function () {
      if (jobs[id] !== job) return;
      if (editor) { editor.remove(); editor = null; }
      option.remove(); region.remove(); reference.el.remove(); strength.el.remove(); job.waiting = false; api.attended();
      record.ok = false; card.classList.add('is-done'); card.querySelector('.card__text').textContent = 'Создание визуализации отменено.'; delete jobs[id];
      api.send({ type: 'tool_result', call_id: msg.call_id, ok: false, content: 'Пользователь отменил визуализацию. Ничего не генерируй.' });
    };
    api.hideEmpty(); api.chat.appendChild(card); api.scroll();
  }
  function frame(id, prompt, large, edit) {
    var el = element('section', 'render');
    var head = element('div', 'render__head'), title = element('span', 'render__title', edit ? 'Постпродакшн · доработка' : large ? 'Постпродакшн · большой кадр' : 'Постпродакшн'), buttons = element('div', 'render__switch');
    var before = element('button', 'btn', 'Исходник'), after = element('button', 'btn', 'Результат');
    before.setAttribute('aria-pressed', 'false'); after.setAttribute('aria-pressed', 'true');
    buttons.appendChild(before); buttons.appendChild(after); head.appendChild(title); head.appendChild(buttons);
    var img = element('img', 'render__image'); img.alt = 'ИИ-визуализация выбранного ракурса'; img.hidden = true; zoomable(img);
    var footer = element('div', 'render__footer'), note = element('span', 'render__note', large ? 'ИИ-визуализация из плиток' : 'ИИ-визуализация'), save = element('button', 'btn render__save', 'Сохранить PNG ↗');
    var refine = element('button', 'btn render__save', 'Доработать область…');
    save.disabled = refine.disabled = true;
    footer.appendChild(note); footer.appendChild(refine); footer.appendChild(save);
    var info = element('div', 'render__status'); info.setAttribute('role', 'status');
    el.appendChild(head);
    // Задание, по которому сделан кадр (в том числе отредактированное).
    if (prompt) { var task = element('div', 'render__prompt', prompt); task.title = 'Задание для генерации'; el.appendChild(task); }
    el.appendChild(img); el.appendChild(footer); el.appendChild(info); api.chat.appendChild(el);
    function setImages(source, result) {
      img.src = imageUrl(result); img.hidden = false;
      before.onclick = function () { img.src = imageUrl(source); img.alt = 'Исходный кадр SketchUp'; before.setAttribute('aria-pressed', 'true'); after.setAttribute('aria-pressed', 'false'); };
      after.onclick = function () { img.src = imageUrl(result); img.alt = 'ИИ-визуализация выбранного ракурса'; before.setAttribute('aria-pressed', 'false'); after.setAttribute('aria-pressed', 'true'); };
    }
    save.onclick = function () {
      save.disabled = true;
      api.rb('save_render', { id: id }).then(function (r) { info.textContent = !r.ok ? r.error : r.cancelled ? '' : 'Сохранено: ' + r.path; }).catch(function (e) { info.textContent = e.message; }).finally(function () { save.disabled = false; });
    };
    var current = { source: null, result: null, camera: null, capture: null, id: id };
    // Доработать область: маска на результате, задание, референс, сила → генерация без хода модели.
    refine.onclick = function () {
      if (!current.result) return;
      window.StultusMask.open({ src: imageUrl(current.result), onDone: function (maskUrl, pct) {
        var form = element('div', 'render__refine');
        var head = element('div', 'render__refine-title', 'Доработка области · ' + pct + '% кадра');
        var ta = element('textarea', 'render__refine-text'); ta.rows = 3; ta.value = ''; ta.placeholder = 'Что изменить в отмеченной области? Например: «замени окно на витраж во всю стену»'; ta.setAttribute('aria-label', 'Задание для доработки');
        var strength = strengthControl(70), reference = referenceControl();
        var row = element('div', 'card__options'), go = element('button', 'btn btn--primary', 'Создать ↗'), no = element('button', 'btn', 'Отмена');
        row.appendChild(go); row.appendChild(no);
        form.appendChild(head); form.appendChild(ta); form.appendChild(reference.el); form.appendChild(strength.el); form.appendChild(row);
        el.insertBefore(form, info); ta.focus();
        no.onclick = function () { form.remove(); };
        go.onclick = function () {
          var text = ta.value.trim() || (prompt || 'Доработать отмеченную область, сохранив всё остальное.');
          form.remove();
          // Размер наследуется: если на диске лежит полный кадр больше превью, на сервер уходит он.
          api.rb('render_file_info', { id: current.id }).then(function (r) {
            var full = r && r.ok && r.preview ? { id: current.id, bytes: r.bytes, width: r.width, height: r.height } : null;
            startEdit({ base: current.result, full: full, camera: current.camera, capture: current.capture, prompt: text, mask: stripPrefix(maskUrl), references: reference.value(), strength: strength.value(), pct: pct });
          }).catch(function () {
            startEdit({ base: current.result, camera: current.camera, capture: current.capture, prompt: text, mask: stripPrefix(maskUrl), references: reference.value(), strength: strength.value(), pct: pct });
          });
        };
      } });
    };
    function setCurrent(source, result, camera, capture) { current.source = source; current.result = result; current.camera = camera || null; current.capture = capture || null; refine.disabled = false; }
    return { el: el, info: info, save: save, setImages: setImages, setCurrent: setCurrent };
  }
  // Доработка: карточка хода работы и запрос на gateway. Результат приходит render_result.
  function startEdit(p) {
    var id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
    var card = document.getElementById('tplShot').content.firstElementChild.cloneNode(true);
    card.classList.add('card--render', 'is-done');
    card.querySelector('.card__title').textContent = 'Дорабатываю область';
    card.querySelector('.card__text').textContent = 'Область ' + p.pct + '% кадра · влияние ' + p.strength + (p.references ? ' · видов: ' + p.references.length : '') + '\n\nЗадание: ' + p.prompt;
    var stop = element('button', 'btn card__stop', 'Остановить'); stop.onclick = function () { api.send({ type: 'render_cancel', id: id }); };
    card.appendChild(stop);
    var record = { name: 'render_edit', label: 'Доработка области', ok: null };
    var job = jobs[id] = { card: card, record: record, source: p.base, camera: p.camera, capture: p.capture, prompt: p.prompt, edit: true, stopButton: stop };
    api.hideEmpty(); api.chat.appendChild(card); api.scroll();
    var text = card.querySelector('.card__text'), head = text.textContent;
    if (!p.full) {
      api.send({ type: 'render_edit', id: id, prompt: p.prompt, base: p.base, mask: p.mask, references: p.references || undefined, strength: p.strength });
      return;
    }
    // Большой кадр: полный файл с диска на сервер кусками по 2 МБ, потом запрос.
    var CHUNK = 2 * 1024 * 1024, total = Math.ceil(p.full.bytes / CHUNK), index = 0, cancelled = false;
    stop.onclick = function () { cancelled = true; api.send({ type: 'render_cancel', id: id }); status({ id: id, text: 'Доработка остановлена.', failed: true }); };
    function next() {
      if (cancelled || jobs[id] !== job) return;
      if (index >= total) {
        text.textContent = head + '\n\nКадр ' + p.full.width + ' × ' + p.full.height + ' передан, дорабатываю в полном разрешении…';
        api.send({ type: 'render_edit', id: id, prompt: p.prompt, base_upload: true, mask: p.mask, references: p.references || undefined, strength: p.strength });
        return;
      }
      text.textContent = head + '\n\nПередаю полный кадр ' + p.full.width + ' × ' + p.full.height + ' на сервер: ' + (index + 1) + '/' + total;
      api.rb('read_render_chunk', { id: p.full.id, index: index, size: CHUNK }).then(function (r) {
        if (!r || !r.ok) throw new Error(r && r.error || 'кусок не прочитан');
        api.send({ type: 'render_upload', id: id, index: r.index, total: r.total, data: r.data });
        index += 1; total = r.total; next();
      }).catch(function (e) { status({ id: id, text: 'Не удалось передать кадр: ' + e.message, failed: true }); });
    }
    next();
  }
  // Полные большие кадры приходят кусками после render_result; куски пишет
  // Ruby в файл по порядку, окно только передаёт их дальше по одному.
  var files = {};
  // saved[id] — обещание «кадр целиком лежит на диске»; его ждёт render_export.
  var saved = {};
  function result(msg) {
    var job = jobs[msg.id]; if (!job) return;
    job.record.ok = true; job.card.remove(); delete jobs[msg.id];
    var output = frame(msg.id, msg.prompt, msg.large, msg.edit); output.setImages(msg.source.base64, msg.image.base64);
    // Размер для сцены — размер снимка (пропорции вьюпорта), а не выхода генератора.
    var capture = job.capture || (msg.full ? { width: msg.full.width, height: msg.full.height } : { width: msg.image.width, height: msg.image.height });
    output.setCurrent(msg.source.base64, msg.image.base64, job.camera || null, capture);
    output.info.textContent = 'Сохраняю кадр на этом компьютере…';
    var meta = { camera: job.camera || null, width: capture.width, height: capture.height, prompt: msg.prompt, edit: !!msg.edit };
    api.remember({ role: 'assistant', text: '', render: { id: msg.id, prompt: msg.prompt, large: !!msg.large, edit: !!msg.edit }, at: new Date().toISOString() });
    var settle = {}; saved[msg.id] = { output: output, promise: new Promise(function (res, rej) { settle.res = res; settle.rej = rej; }) };
    if (msg.full) files[msg.id] = { output: output, full: msg.full, queue: Promise.resolve(), received: 0, settle: settle };
    api.rb('cache_render', { id: msg.id, image: msg.image.base64, source: msg.source.base64, preview: !!msg.full, meta: meta }).then(function (r) {
      if (!r.ok) { output.info.textContent = 'Не удалось сохранить кадр: ' + r.error; settle.rej(new Error(r.error)); return; }
      if (!msg.full) { output.info.textContent = ''; output.save.disabled = false; settle.res(); }
      else output.info.textContent = 'Получаю полный кадр ' + msg.full.width + ' × ' + msg.full.height + '…';
      api.persist();
    }).catch(function (e) { output.info.textContent = 'Не удалось сохранить кадр: ' + e.message; settle.rej(e); });
    api.scroll();
  }
  function chunk(msg) {
    var f = files[msg.id]; if (!f) return;
    f.queue = f.queue.then(function () {
      return api.rb('render_chunk', { id: msg.id, index: msg.index, total: msg.total, data: msg.data }).then(function (r) {
        if (!r.ok) throw new Error(r.error || 'ошибка записи');
        f.received++;
        if (r.done) {
          f.output.info.textContent = 'Полный кадр ' + f.full.width + ' × ' + f.full.height + ' (' + Math.round(f.full.bytes / 1048576) + ' МБ) сохранён на этом компьютере.';
          f.output.save.disabled = false; delete files[msg.id]; f.settle.res();
        } else f.output.info.textContent = 'Получаю полный кадр ' + f.full.width + ' × ' + f.full.height + '… ' + f.received + '/' + msg.total;
      });
    }).catch(function (e) { f.output.info.textContent = 'Полный кадр не сохранён: ' + e.message; delete files[msg.id]; f.settle.rej(e); });
  }
  // Gateway спрашивает, лёг ли кадр на диск, и просит скопировать по пути.
  function exportDone(msg) {
    var id = msg.args.render_id, path = (msg.args.save_path || '').trim();
    var entry = saved[id];
    var reply = function (ok, content) { api.send({ type: 'tool_result', call_id: msg.call_id, ok: ok, content: content }); };
    if (!entry) return reply(false, 'Кадр не найден в окне.');
    // Страховка: если куски так и не дошли, не держим ход вечно.
    var timeout = new Promise(function (_, rej) { setTimeout(function () { rej(new Error('полный кадр не дошёл за 5 минут')); }, 5 * 60 * 1000); });
    Promise.race([entry.promise, timeout]).then(function () {
      delete saved[id];
      if (!path) return reply(true, 'Кадр сохранён на компьютере пользователя; под ним кнопка «Сохранить PNG».');
      return api.rb('export_render', { id: id, path: path }).then(function (r) {
        if (!r.ok) { entry.output.info.textContent = 'Не удалось сохранить в ' + path + ': ' + r.error; return reply(true, 'Кадр в чате, но сохранить по пути не удалось: ' + r.error); }
        entry.output.info.textContent = 'Сохранено: ' + r.path;
        reply(true, 'Файл сохранён: ' + r.path + ' (' + Math.round(r.bytes / 1024) + ' КБ).');
      });
    }).catch(function (e) { delete saved[id]; reply(true, 'Кадр показан, но на диск не лёг: ' + e.message); });
  }
  function restore(data) {
    api.hideEmpty(); var output = frame(data.id, data.prompt, data.large, data.edit); output.info.textContent = 'Загружаю сохранённый кадр…';
    api.rb('get_render', { id: data.id }).then(function (r) {
      if (!r.ok) { output.info.textContent = r.error; return; }
      output.setImages(r.source, r.image); output.save.disabled = false; output.info.textContent = '';
      output.setCurrent(r.source, r.image, r.meta && r.meta.camera, r.meta && r.meta.width ? { width: r.meta.width, height: r.meta.height } : null);
    }).catch(function (e) { output.info.textContent = e.message; });
  }
  function cancel() {
    Object.keys(jobs).forEach(function (id) { if (!jobs[id].edit) status({ id: id, text: 'Визуализация прервана. Можно повторить запрос.', failed: true }); });
  }
  return { request: request, status: status, result: result, chunk: chunk, exportDone: exportDone, restore: restore, cancel: cancel };
};
