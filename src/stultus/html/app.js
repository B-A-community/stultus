/*
  Stultus — окно чата.

  Две связи:
    * с Ruby (SketchUp): sketchup.<callback>(id, json) → Stultus.receive({id, result});
    * с gateway: WebSocket, JSON-конверты (см. docs/PROTOCOL.md).

  Инструменты модели исполняет Ruby; сюда приходит tool_call от gateway,
  мы зовём Ruby и отправляем tool_result обратно. Снимок вьюпорта — только
  после нажатия кнопки пользователем.
*/
(function () {
  'use strict';

  // ---------- Мост к Ruby -------------------------------------------------
  var pendingRuby = {};
  var rubySeq = 0;

  function rb(name, payload) {
    return new Promise(function (resolve, reject) {
      var id = 'r' + (++rubySeq);
      pendingRuby[id] = { resolve: resolve, reject: reject };
      if (!window.sketchup || typeof window.sketchup[name] !== 'function') {
        delete pendingRuby[id];
        reject(new Error('Нет моста SketchUp: ' + name));
        return;
      }
      try {
        window.sketchup[name](id, JSON.stringify(payload || {}));
      } catch (e) {
        delete pendingRuby[id];
        reject(e);
      }
    });
  }

  // Ошибки страницы — в журнал плагина: внутри SketchUp консоли нет.
  window.addEventListener('error', function (e) {
    try { window.sketchup && window.sketchup.log && window.sketchup.log('e', JSON.stringify({ text: 'error: ' + e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno })); } catch (_) {}
  });
  window.addEventListener('unhandledrejection', function (e) {
    try { window.sketchup && window.sketchup.log && window.sketchup.log('e', JSON.stringify({ text: 'rejection: ' + (e.reason && e.reason.message || e.reason) })); } catch (_) {}
  });

  window.Stultus = {
    log: function (text) { rb('log', { text: String(text) }).catch(function () {}); },
    receive: function (msg) {
      var p = pendingRuby[msg.id];
      if (!p) return;
      delete pendingRuby[msg.id];
      p.resolve(msg.result);
    },
    // Ruby пушит сюда выделение при каждом его изменении в SketchUp.
    selection: function (sel) {
      state.selection = sel || null;
      renderContext();
    },
    // Текст для строки контекста в композере; его же берёт ui.js.
    contextText: function (sceneOn) {
      var sel = state.selection && state.selection.text ? state.selection.text : 'ничего не выделено';
      return (sceneOn ? 'Контекст сцены' : 'Без контекста') + ' · ' + sel;
    }
  };

  // ---------- Состояние ---------------------------------------------------
  var state = {
    settings: {},
    providers: [],
    sessions: {},      // { claude: 'uuid', codex: 'thread' } — в файле модели
    instance: null,
    messages: [],      // то, что сохраняем в модель: {role, text, tools:[{name,label,ok}]}
    ws: null,
    wsState: 'disconnected',
    busy: false,
    turn: 0,
    reconnectTimer: null,
    reconnectDelay: 1000,
    current: null,     // текущий ответ: {el, bodyEl, text, tools:[]}
    usage: null,
    selection: null    // { count, text, by_type, definitions } — живое выделение из SketchUp
  };

  var $ = function (id) { return document.getElementById(id); };
  var app = $('app'), chat = $('chat'), input = $('input');
  var renders = window.StultusRender({ rb: rb, chat: chat, send: send, scroll: scrollDown, hideEmpty: hideEmpty,
    persist: persist, remember: function (message) { finishCurrent(); state.messages.push(message); } });

  // ---------- Рендер ------------------------------------------------------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Минимальный markdown: код-блоки, инлайн-код, жирный, списки, абзацы.
  function renderMarkdown(text) {
    var parts = String(text).split(/```/);
    var html = '';
    for (var i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        var code = parts[i].replace(/^[a-zA-Z0-9_-]*\n/, '');
        html += '<pre><code>' + escapeHtml(code) + '</code></pre>';
      } else {
        var t = escapeHtml(parts[i]);
        t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
        t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
        t = t.replace(/(^|\n)((?:[-*] .*(?:\n|$))+)/g, function (_m, pre, list) {
          var items = list.trim().split('\n').map(function (l) { return '<li>' + l.replace(/^[-*] /, '') + '</li>'; }).join('');
          return pre + '<ul>' + items + '</ul>';
        });
        html += t;
      }
    }
    return html;
  }

  function scrollDown() { chat.scrollTop = chat.scrollHeight; }

  function hideEmpty() { var e = $('chatEmpty'); if (e) e.hidden = true; }

  function addMessage(role, text, opts) {
    hideEmpty();
    var el = $('tplMessage').content.firstElementChild.cloneNode(true);
    el.classList.add('msg--' + role);
    el.querySelector('.msg__role').textContent =
      role === 'user' ? 'Вы' : role === 'assistant' ? ((opts && opts.provider) || 'Модель') : '';
    var body = el.querySelector('.msg__body');
    if (role === 'assistant') body.innerHTML = renderMarkdown(text || '');
    else body.textContent = text || '';
    if (role === 'system' || role === 'error') el.querySelector('.msg__role').remove();
    chat.appendChild(el);
    scrollDown();
    return el;
  }

  function addTool(call) {
    hideEmpty();
    var el = $('tplTool').content.firstElementChild.cloneNode(true);
    el.dataset.state = 'running';
    el.dataset.callId = call.call_id;
    el.querySelector('.tool__name').textContent = call.name;
    el.querySelector('.tool__label').textContent = toolLabel(call);
    el.querySelector('.tool__state').textContent = 'выполняется…';
    el.querySelector('.tool__args').textContent = toolArgsPreview(call);
    chat.appendChild(el);
    scrollDown();
    return el;
  }

  function toolLabel(call) {
    var a = call.args || {};
    if (call.name === 'execute_ruby') return a.label || (String(a.code || '').split('\n')[0].slice(0, 80));
    if (call.name === 'take_screenshot') return a.reason || '';
    if (call.name === 'render_viewport') return 'Постпродакшн текущего кадра';
    if (call.name === 'ask_user') return a.question || '';
    if (call.name === 'select') return a.mode === 'clear' ? 'снять выделение' : 'выделить ' + ((a.ids || []).length) + ' объект(ов)';
    return '';
  }

  function toolArgsPreview(call) {
    var a = call.args || {};
    if (call.name === 'execute_ruby') return String(a.code || '');
    return JSON.stringify(a, null, 2);
  }

  function finishTool(el, ok, resultText) {
    el.dataset.state = ok ? 'ok' : 'error';
    el.querySelector('.tool__state').textContent = ok ? 'готово' : 'ошибка';
    el.querySelector('.tool__result').textContent = resultText || '';
    if (!ok) el.open = true;
  }

  function setStatus(s, text) {
    state.wsState = s;
    app.dataset.state = state.busy ? 'busy' : s;
    $('connStatus').querySelector('.topbar__statusText').textContent = text;
  }

  function setBusy(b) {
    if (!b) renders.cancel();
    state.busy = b;
    app.dataset.state = b ? 'busy' : state.wsState;
    $('btnSend').disabled = b;
    $('btnCancel').hidden = !b;
  }

  function hint(text) { $('composerHint').textContent = text || ''; }

  function renderContext() {
    var el = $('contextLabel');
    if (el) el.textContent = window.Stultus.contextText($('attachScene').checked);
  }

  // ---------- История -----------------------------------------------------
  function restoreHistory(messages) {
    renders.cancel();
    chat.querySelectorAll('.msg, .tool, .card, .render').forEach(function (n) { n.remove(); });
    state.messages = messages || [];
    state.messages.forEach(function (m) {
      if (m.render) { renders.restore(m.render); return; }
      if (m.role === 'user') addMessage('user', m.text);
      else if (m.role === 'assistant') {
        (m.tools || []).forEach(function (t) {
          var el = addTool({ call_id: '', name: t.name, args: { label: t.label, reason: t.label, question: t.label } });
          el.querySelector('.tool__args').textContent = '';
          finishTool(el, t.ok !== false, '');
        });
        // Ход без текста (только вызовы) — пузыря не было и при живом ходе.
        if (m.text) addMessage('assistant', m.text, { provider: m.provider });
      }
    });
    if (state.messages.length) hideEmpty();
  }

  function persist() {
    rb('save_history', { messages: state.messages }).catch(function () {});
  }

  function persistSessions() {
    rb('save_sessions', { sessions: state.sessions }).catch(function () {});
  }

  // ---------- Gateway -----------------------------------------------------
  function connect() {
    if (state.ws) { try { state.ws.close(); } catch (e) {} state.ws = null; }
    clearTimeout(state.reconnectTimer);
    var url = (state.settings.gateway || '').trim();
    if (!url) { setStatus('disconnected', 'адрес gateway не задан'); return; }
    setStatus('connecting', 'подключение…');
    var ws;
    try { ws = new WebSocket(url); } catch (e) { setStatus('disconnected', 'плохой адрес'); return; }
    state.ws = ws;
    ws.onopen = function () {
      state.reconnectDelay = 1000;
      send({ type: 'hello', token: state.settings.token || '', instance: state.instance, sessions: state.sessions, plugin: (state.instance && state.instance.plugin) || '' });
    };
    ws.onmessage = function (ev) {
      var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handle(msg);
    };
    ws.onclose = function (ev) {
      if (state.ws !== ws) return;
      state.ws = null;
      if (state.busy) { setBusy(false); finishCurrent(); addMessage('error', 'Соединение с gateway оборвалось посреди хода.'); }
      setStatus('disconnected', ev.code === 4401 ? 'пропуск не принят' : 'нет связи');
      if (ev.code !== 4401) {
        state.reconnectTimer = setTimeout(connect, state.reconnectDelay);
        state.reconnectDelay = Math.min(state.reconnectDelay * 2, 15000);
      }
    };
    ws.onerror = function () {};
  }

  function send(obj) {
    if (!state.ws || state.ws.readyState !== 1) return false;
    state.ws.send(JSON.stringify(obj));
    return true;
  }

  function handle(msg) {
    switch (msg.type) {
      case 'render_status': renders.status(msg); break;
      case 'render_result': renders.result(msg); break;
      case 'welcome':
        state.providers = msg.providers || [];
        setStatus('connected', 'gateway ' + (msg.version || ''));
        fillProviders();
        break;
      case 'turn_start':
        break;
      case 'status':
        hint(msg.text || '');
        break;
      case 'text':
        appendText(msg.delta || '');
        break;
      case 'text_replace':
        replaceText(msg.text || '');
        break;
      case 'tool_call':
        onToolCall(msg);
        break;
      case 'ask':
        onAsk(msg);
        break;
      case 'session':
        if (msg.provider && msg.id) { state.sessions[msg.provider] = msg.id; persistSessions(); }
        break;
      case 'done':
        onDone(msg);
        break;
      case 'error':
        finishCurrent();
        addMessage('error', msg.message || 'Ошибка gateway');
        setBusy(false);
        hint('');
        break;
    }
  }

  function fillProviders() {
    var ps = $('providerSelect'), ms = $('modelSelect');
    ps.innerHTML = '';
    state.providers.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.label + (p.configured ? '' : ' (не настроен)');
      o.disabled = !p.configured;
      ps.appendChild(o);
    });
    var wanted = state.settings.provider;
    var ok = state.providers.some(function (p) { return p.id === wanted && p.configured; });
    if (!ok) {
      var first = state.providers.filter(function (p) { return p.configured; })[0];
      wanted = first ? first.id : (state.providers[0] && state.providers[0].id);
    }
    ps.value = wanted || '';
    fillModels();
  }

  function fillModels() {
    var ms = $('modelSelect');
    var p = currentProvider();
    ms.innerHTML = '';
    if (!p) return;
    (p.models || []).forEach(function (m) {
      var o = document.createElement('option');
      o.value = m.id; o.textContent = m.label || m.id;
      ms.appendChild(o);
    });
    var wanted = state.settings.model;
    if (!(p.models || []).some(function (m) { return m.id === wanted; })) wanted = p.default || ((p.models || [])[0] || {}).id;
    ms.value = wanted || '';
  }

  function currentProvider() {
    var id = $('providerSelect').value;
    return state.providers.filter(function (p) { return p.id === id; })[0] || null;
  }

  // ---------- Ход ---------------------------------------------------------
  function sendChat() {
    var text = input.value.trim();
    if (!text || state.busy) return;
    if (!state.ws || state.ws.readyState !== 1) { hint('Нет связи с gateway — проверьте настройки.'); return; }
    var provider = $('providerSelect').value, model = $('modelSelect').value;
    if (!provider) { hint('Провайдер не выбран.'); return; }

    input.value = '';
    hint('');
    addMessage('user', text);
    state.messages.push({ role: 'user', text: text, at: new Date().toISOString() });
    setBusy(true);
    state.turn += 1;
    startCurrent(provider);

    // Выделение уходит всегда: это то, о чём пользователь говорит «это».
    // Галочка решает только, класть ли полный снимок сцены.
    var full = $('attachScene').checked;
    var go = function (scene) {
      send({ type: 'chat', turn: state.turn, text: text, provider: provider, model: model, scene: scene || null, sessions: state.sessions });
    };
    rb('scene_state', { full: full }).then(go, function () { go(null); });
  }

  // Текущий ход модели. Текст идёт пузырями: каждый вызов инструмента
  // закрывает пузырь, следующий текст открывает новый — так порядок
  // «сказал → сделал → сказал» читается и в окне, и в истории.
  function startCurrent(provider) {
    state.current = { provider: provider, text: '', tools: [], el: null, body: null };
  }

  function providerLabel(id) {
    var p = state.providers.filter(function (x) { return x.id === id; })[0];
    return p ? p.label : id;
  }

  function ensureBubble() {
    var c = state.current;
    if (c.el && c.el === chat.lastElementChild) return;
    if (c.el) commitText();
    c.el = addMessage('assistant', '', { provider: providerLabel(c.provider) });
    c.el.classList.add('is-streaming');
    c.body = c.el.querySelector('.msg__body');
    c.text = '';
  }

  // Закрыть пузырь: текст (и накопленные к нему вызовы) — в историю.
  function commitText() {
    var c = state.current;
    if (!c || !c.el) return;
    c.el.classList.remove('is-streaming');
    if (c.text) {
      state.messages.push({ role: 'assistant', text: c.text, tools: c.tools, provider: providerLabel(c.provider), at: new Date().toISOString() });
      c.tools = [];
    } else {
      c.el.remove();
    }
    c.el = null; c.body = null; c.text = '';
  }

  function appendText(delta) {
    if (!state.current) startCurrent($('providerSelect').value);
    ensureBubble();
    // Разделитель абзацев от провайдера в начале нового пузыря — пустые
    // строки сверху; пузырь начинается с текста.
    if (!state.current.text) delta = delta.replace(/^\s+/, '');
    if (!delta) return;
    state.current.text += delta;
    state.current.body.innerHTML = renderMarkdown(state.current.text);
    scrollDown();
  }

  function replaceText(text) {
    if (!state.current) startCurrent($('providerSelect').value);
    ensureBubble();
    state.current.text = text;
    state.current.body.innerHTML = renderMarkdown(text);
    scrollDown();
  }

  function finishCurrent() {
    var c = state.current;
    if (!c) return;
    commitText();
    if (c.tools.length) {
      state.messages.push({ role: 'assistant', text: '', tools: c.tools, provider: providerLabel(c.provider), at: new Date().toISOString() });
    }
    state.current = null;
  }

  function onDone(msg) {
    finishCurrent();
    setBusy(false);
    hint('');
    if (msg.usage) {
      state.usage = msg.usage;
      var u = msg.usage;
      $('usage').textContent = 'ход: ' + fmt(u.input || 0) + ' вх / ' + fmt(u.output || 0) + ' вых' +
        (u.cached ? ' (из кэша ' + fmt(u.cached) + ')' : '') + (u.cost != null ? ' · $' + Number(u.cost).toFixed(3) : '');
    }
    persist();
  }

  function fmt(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }

  // ---------- Инструменты -------------------------------------------------
  function onToolCall(msg) {
    if (!state.current) startCurrent($('providerSelect').value);
    // Пришёл инструмент — текущий пузырь закрывается, следующий текст
    // откроет новый (см. ensureBubble).
    commitText();
    var record = { name: msg.name, label: toolLabel(msg), ok: null };
    state.current.tools.push(record);

    if (msg.name === 'take_screenshot') return onScreenshotRequest(msg, record);
    if (msg.name === 'render_viewport') return renders.request(msg, record);
    if (msg.name === 'ask_user') return onAskTool(msg, record);

    var el = addTool(msg);
    var run;
    if (msg.name === 'execute_ruby') run = rb('execute_ruby', { code: msg.args.code, label: msg.args.label });
    else if (msg.name === 'get_scene') run = rb('scene_state', { full: true });
    else if (msg.name === 'select') run = rb('select', msg.args || {});
    else if (msg.name === 'undo') run = rb('undo');
    else run = Promise.reject(new Error('Неизвестный инструмент: ' + msg.name));

    run.then(function (result) {
      var ok = result && result.ok !== false;
      record.ok = ok;
      var text = formatResult(msg.name, result);
      finishTool(el, ok, text);
      send({ type: 'tool_result', call_id: msg.call_id, ok: ok, content: text });
    }, function (err) {
      record.ok = false;
      finishTool(el, false, String(err && err.message || err));
      send({ type: 'tool_result', call_id: msg.call_id, ok: false, content: String(err && err.message || err) });
    });
  }

  function formatResult(name, result) {
    if (!result) return 'нет ответа';
    if (name === 'execute_ruby') {
      var lines = [];
      if (result.ok === false) { lines.push('ОШИБКА: ' + result.error); if (result.backtrace) lines.push(result.backtrace.join('\n')); lines.push('Операция откачена (abort_operation).'); }
      else lines.push('result: ' + result.result);
      if (result.output) lines.push('stdout:\n' + result.output);
      return lines.join('\n');
    }
    var copy = Object.assign({}, result); delete copy.ok;
    return JSON.stringify(copy, null, 1);
  }

  function onScreenshotRequest(msg, record) {
    hideEmpty();
    var card = $('tplShot').content.firstElementChild.cloneNode(true);
    var a = msg.args || {};
    var desc = (a.reason || 'Модель хочет посмотреть на результат.') +
      (a.view ? '\nВид: ' + a.view : '') + (a.zoom_extents ? ' · показать всё' : '');
    card.querySelector('.card__text').textContent = desc;
    chat.appendChild(card); scrollDown();

    card.querySelector('[data-act="allow"]').onclick = function () {
      card.classList.add('is-done');
      rb('screenshot', { view: a.view, zoom_extents: !!a.zoom_extents, width: 1280, height: 800 }).then(function (r) {
        if (!r || r.ok === false) {
          record.ok = false;
          send({ type: 'tool_result', call_id: msg.call_id, ok: false, content: 'Снимок не удался: ' + (r && r.error) });
          return;
        }
        record.ok = true;
        var img = card.querySelector('.card__preview');
        img.src = 'data:' + r.mime + ';base64,' + r.base64; img.hidden = false;
        send({ type: 'tool_result', call_id: msg.call_id, ok: true, content: 'Снимок вьюпорта ' + r.width + 'x' + r.height + (a.view ? ', вид ' + a.view : ''), image: { mime: r.mime, base64: r.base64 } });
      });
    };
    card.querySelector('[data-act="deny"]').onclick = function () {
      card.classList.add('is-done');
      record.ok = false;
      send({ type: 'tool_result', call_id: msg.call_id, ok: false, content: 'Пользователь отказал в снимке. Продолжай без него или спроси, что именно проверить.' });
    };
  }

  function onAskTool(msg, record) {
    record.ok = true;
    onAsk({ question: (msg.args || {}).question, options: (msg.args || {}).options });
    send({ type: 'tool_result', call_id: msg.call_id, ok: true, content: 'Вопрос показан пользователю. Закончи ход и жди ответа — ничего не строй.' });
  }

  function onAsk(msg) {
    hideEmpty();
    var card = $('tplAsk').content.firstElementChild.cloneNode(true);
    card.querySelector('.card__text').textContent = msg.question || '';
    var box = card.querySelector('.card__options');
    (msg.options || []).forEach(function (opt) {
      var b = document.createElement('button'); b.className = 'btn'; b.textContent = opt;
      b.onclick = function () { card.classList.add('is-done'); input.value = opt; sendChat(); };
      box.appendChild(b);
    });
    chat.appendChild(card); scrollDown();
    state.messages.push({ role: 'assistant', text: 'Вопрос: ' + (msg.question || ''), tools: [], provider: providerLabel($('providerSelect').value), at: new Date().toISOString() });
  }

  // ---------- Настройки ---------------------------------------------------
  function openSettings() {
    $('setGateway').value = state.settings.gateway || '';
    $('setToken').value = state.settings.token || '';
    $('settingsInfo').textContent = state.instance ? ('SketchUp ' + state.instance.app_version + ' · плагин ' + state.instance.plugin + ' · ' + state.instance.model_title) : '';
    $('settings').hidden = false;
  }

  function saveSettings() {
    var s = { gateway: $('setGateway').value.trim(), token: $('setToken').value.trim() };
    rb('save_settings', { settings: s }).then(function (r) {
      state.settings = (r && r.settings) || Object.assign(state.settings, s);
      $('settings').hidden = true;
      connect();
    });
  }

  function saveChoice() {
    var s = { provider: $('providerSelect').value, model: $('modelSelect').value, attach_scene: $('attachScene').checked };
    Object.assign(state.settings, s);
    rb('save_settings', { settings: s }).catch(function () {});
  }

  // ---------- События -----------------------------------------------------
  $('btnSend').onclick = sendChat;
  $('btnCancel').onclick = function () { renders.cancel(); send({ type: 'cancel' }); hint('Останавливаю…'); };
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendChat(); }
  });
  $('btnSettings').onclick = openSettings;
  $('btnCloseSettings').onclick = function () { $('settings').hidden = true; };
  $('btnSaveSettings').onclick = saveSettings;
  $('btnClearHistory').onclick = function () {
    if (!confirm('Стереть переписку из этой модели? Сессии провайдеров тоже сбросятся.')) return;
    rb('clear_history').then(function () { state.sessions = {}; restoreHistory([]); $('chatEmpty').hidden = false; $('settings').hidden = true; });
  };
  $('btnNew').onclick = function () {
    if (state.busy) return;
    if (!confirm('Начать новый разговор? Текущая переписка в модели будет очищена.')) return;
    rb('clear_history').then(function () { state.sessions = {}; restoreHistory([]); $('chatEmpty').hidden = false; $('usage').textContent = ''; });
  };
  $('providerSelect').onchange = function () { fillModels(); saveChoice(); };
  $('modelSelect').onchange = saveChoice;
  $('attachScene').onchange = function () { saveChoice(); renderContext(); };

  // ---------- Старт -------------------------------------------------------
  function boot() {
    rb('ready').then(function (r) {
      state.settings = r.settings || {};
      state.instance = r.instance || null;
      state.sessions = r.sessions || {};
      $('modelTitle').textContent = state.instance ? state.instance.model_title : '';
      $('attachScene').checked = state.settings.attach_scene !== false;
      state.selection = r.selection || null;
      renderContext();
      restoreHistory(r.history || []);
      if (!state.settings.gateway) openSettings();
      connect();
    }, function (err) {
      addMessage('error', 'Ruby не ответил: ' + err.message);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
