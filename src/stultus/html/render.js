/* Postproduction cards. No network or credentials here; all work goes through gateway. */
window.StultusRender = function (api) {
  'use strict';
  var jobs = {};
  function imageUrl(base64) { return 'data:image/png;base64,' + base64; }
  function element(tag, name, text) { var el = document.createElement(tag); el.className = name; if (text) el.textContent = text; return el; }
  function status(msg) {
    var job = jobs[msg.id]; if (!job) return;
    job.card.querySelector('.card__text').textContent = msg.text;
    if (msg.failed) { job.record.ok = false; job.card.classList.add('is-failed', 'is-done'); delete jobs[msg.id]; }
  }
  function request(msg, record) {
    var id = msg.args.render_id;
    var card = document.getElementById('tplShot').content.firstElementChild.cloneNode(true);
    card.classList.add('card--render');
    card.querySelector('.card__title').textContent = 'Создать визуализацию этого вида?';
    card.querySelector('.card__text').textContent = msg.args.prompt + '\n\nТекущий кадр будет передан генератору Codex. Используются лимиты вашей подписки. Камера и модель останутся прежними.';
    var allow = card.querySelector('[data-act=allow]'), deny = card.querySelector('[data-act=deny]');
    allow.textContent = 'Зафиксировать и создать ↗'; deny.textContent = 'Отмена';
    var job = jobs[id] = { card: card, record: record, source: null };
    allow.onclick = function () {
      if (jobs[id] !== job) return;
      allow.disabled = deny.disabled = true;
      card.querySelector('.card__text').textContent = 'Фиксирую текущий кадр…';
      api.rb('screenshot', { framing: 'viewport' }).then(function (r) {
        if (jobs[id] !== job) return;
        if (!r || !r.ok) throw new Error(r && r.error || 'Снимок не получен.');
        job.source = r.base64;
        var preview = card.querySelector('.card__preview'); preview.src = imageUrl(r.base64); preview.hidden = false;
        card.classList.add('is-done');
        card.querySelector('.card__title').textContent = 'Кадр зафиксирован';
        card.querySelector('.card__text').textContent = r.width + ' × ' + r.height + ' · создаю визуализацию…';
        api.send({ type: 'tool_result', call_id: msg.call_id, ok: true, content: 'Точный кадр вьюпорта разрешён для постпродакшна.', image: { mime: r.mime, base64: r.base64 }, capture: { framing: r.framing, width: r.width, height: r.height } });
        api.scroll();
      }).catch(function (error) {
        if (jobs[id] !== job) return;
        status({ id: id, text: error.message, failed: true });
        api.send({ type: 'tool_result', call_id: msg.call_id, ok: false, content: error.message });
      });
    };
    deny.onclick = function () {
      if (jobs[id] !== job) return;
      record.ok = false; card.classList.add('is-done'); card.querySelector('.card__text').textContent = 'Создание визуализации отменено.'; delete jobs[id];
      api.send({ type: 'tool_result', call_id: msg.call_id, ok: false, content: 'Пользователь отменил визуализацию. Ничего не генерируй.' });
    };
    api.hideEmpty(); api.chat.appendChild(card); api.scroll();
  }
  function frame(id) {
    var el = element('section', 'render');
    var head = element('div', 'render__head'), title = element('span', 'render__title', 'Постпродакшн'), buttons = element('div', 'render__switch');
    var before = element('button', 'btn', 'Исходник'), after = element('button', 'btn', 'Результат');
    before.setAttribute('aria-pressed', 'false'); after.setAttribute('aria-pressed', 'true');
    buttons.appendChild(before); buttons.appendChild(after); head.appendChild(title); head.appendChild(buttons);
    var img = element('img', 'render__image'); img.alt = 'ИИ-визуализация выбранного ракурса'; img.hidden = true;
    var footer = element('div', 'render__footer'), note = element('span', 'render__note', 'ИИ-визуализация · сравните с исходником'), save = element('button', 'btn render__save', 'Сохранить PNG ↗');
    save.disabled = true; footer.appendChild(note); footer.appendChild(save);
    var info = element('div', 'render__status'); info.setAttribute('role', 'status');
    el.appendChild(head); el.appendChild(img); el.appendChild(footer); el.appendChild(info); api.chat.appendChild(el);
    function setImages(source, result) {
      img.src = imageUrl(result); img.hidden = false;
      before.onclick = function () { img.src = imageUrl(source); img.alt = 'Исходный кадр SketchUp'; before.setAttribute('aria-pressed', 'true'); after.setAttribute('aria-pressed', 'false'); };
      after.onclick = function () { img.src = imageUrl(result); img.alt = 'ИИ-визуализация выбранного ракурса'; before.setAttribute('aria-pressed', 'false'); after.setAttribute('aria-pressed', 'true'); };
    }
    save.onclick = function () {
      save.disabled = true;
      api.rb('save_render', { id: id }).then(function (r) { info.textContent = !r.ok ? r.error : r.cancelled ? '' : 'Сохранено: ' + r.path; }).catch(function (e) { info.textContent = e.message; }).finally(function () { save.disabled = false; });
    };
    return { el: el, info: info, save: save, setImages: setImages };
  }
  function result(msg) {
    var job = jobs[msg.id]; if (!job) return;
    job.record.ok = true; job.card.remove(); delete jobs[msg.id];
    var output = frame(msg.id); output.setImages(msg.source.base64, msg.image.base64);
    output.info.textContent = 'Сохраняю кадр на этом компьютере…';
    api.remember({ role: 'assistant', text: '', render: { id: msg.id, prompt: msg.prompt }, at: new Date().toISOString() });
    api.rb('cache_render', { id: msg.id, image: msg.image.base64, source: msg.source.base64 }).then(function (r) {
      output.info.textContent = r.ok ? '' : 'Не удалось сохранить кадр: ' + r.error;
      output.save.disabled = !r.ok;
      api.persist();
    }).catch(function (e) { output.info.textContent = 'Не удалось сохранить кадр: ' + e.message; });
    api.scroll();
  }
  function restore(data) {
    api.hideEmpty(); var output = frame(data.id); output.info.textContent = 'Загружаю сохранённый кадр…';
    api.rb('get_render', { id: data.id }).then(function (r) {
      if (!r.ok) { output.info.textContent = r.error; return; }
      output.setImages(r.source, r.image); output.save.disabled = false; output.info.textContent = '';
    }).catch(function (e) { output.info.textContent = e.message; });
  }
  function cancel() {
    Object.keys(jobs).forEach(function (id) { status({ id: id, text: 'Визуализация прервана. Можно повторить запрос.', failed: true }); });
  }
  return { request: request, status: status, result: result, restore: restore, cancel: cancel };
};
