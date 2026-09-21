/* Рисовалка области поверх кадра: кисть, ластик, масштаб колесом и ползунком,
   панорама правой кнопкой (или средней, или Space + левая). Маска отдаётся
   PNG в разрешении картинки: белое — менять, чёрное — оставить. Только canvas. */
window.StultusMask = (function () {
  'use strict';
  function element(tag, name, text) { var el = document.createElement(tag); el.className = name; if (text) el.textContent = text; return el; }

  // open({ src, initial?, onDone(maskDataUrl, coveragePercent), onCancel })
  function open(opts) {
    var overlay = element('div', 'mask');
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-label', 'Область для изменения');
    var stage = element('div', 'mask__stage'), frame = element('div', 'mask__frame');
    var img = new Image();
    var paint = document.createElement('canvas'); paint.className = 'mask__paint';
    var view = document.createElement('canvas'); view.className = 'mask__view';
    var bar = element('div', 'mask__bar');
    var hint = element('span', 'mask__hint', 'Закрасьте, что должно измениться. Колесо мыши — масштаб, средняя кнопка (или правая) — сдвинуть картинку.');
    var sizeLabel = element('label', 'mask__size', 'Кисть ');
    var size = document.createElement('input'); size.type = 'range'; size.min = 0.3; size.max = 30; size.step = 0.1; size.value = 6; size.setAttribute('aria-label', 'Размер кисти');
    var sizeOut = element('span', 'mask__out', '');
    sizeLabel.appendChild(size); sizeLabel.appendChild(sizeOut);
    var zoomLabel = element('label', 'mask__size', 'Масштаб ');
    var zoom = document.createElement('input'); zoom.type = 'range'; zoom.min = 1; zoom.max = 8; zoom.step = 0.1; zoom.value = 1; zoom.setAttribute('aria-label', 'Масштаб');
    var zoomOut = element('span', 'mask__out', '×1');
    zoomLabel.appendChild(zoom); zoomLabel.appendChild(zoomOut);
    var brush = element('button', 'btn', 'Кисть'), eraser = element('button', 'btn', 'Ластик'), clear = element('button', 'btn', 'Очистить');
    var cancel = element('button', 'btn', 'Отмена'), done = element('button', 'btn btn--primary', 'Готово ↗');
    // Назад/вперёд: стрелки-развороты, Ctrl+Z / Ctrl+Y.
    var UNDO_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6 4 10.5 9 15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 10.5H15a4.5 4.5 0 0 1 0 9H9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
    var REDO_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6 5 4.5-5 4.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M19.5 10.5H9a4.5 4.5 0 0 0 0 9h6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
    var undoBtn = element('button', 'btn mask__step'), redoBtn = element('button', 'btn mask__step');
    undoBtn.innerHTML = UNDO_SVG; redoBtn.innerHTML = REDO_SVG;
    undoBtn.title = 'Назад (Ctrl+Z)'; redoBtn.title = 'Вперёд (Ctrl+Y)';
    undoBtn.setAttribute('aria-label', 'Назад'); redoBtn.setAttribute('aria-label', 'Вперёд');
    undoBtn.disabled = redoBtn.disabled = true;
    brush.setAttribute('aria-pressed', 'true'); eraser.setAttribute('aria-pressed', 'false');
    var sliders = element('div', 'mask__sliders'); sliders.appendChild(zoomLabel); sliders.appendChild(sizeLabel);
    var tools = element('div', 'mask__tools');
    [undoBtn, redoBtn, brush, eraser, clear, cancel, done].forEach(function (n) { tools.appendChild(n); });
    bar.appendChild(hint); bar.appendChild(sliders); bar.appendChild(tools);
    frame.appendChild(view); stage.appendChild(frame); overlay.appendChild(stage); overlay.appendChild(bar);
    document.body.appendChild(overlay);

    var erasing = false, drawing = false, last = null, space = false;
    var scale = 1, tx = 0, ty = 0, fitW = 0, fitH = 0, panning = null;
    var pctx = paint.getContext('2d'), vctx = view.getContext('2d');
    // История штрихов: снимок маски перед каждым штрихом, до 40 шагов.
    var undo = [], redo = [];
    function snapshot() { return pctx.getImageData(0, 0, paint.width, paint.height); }
    function remember() { undo.push(snapshot()); if (undo.length > 40) undo.shift(); redo.length = 0; steps(); }
    function steps() { undoBtn.disabled = !undo.length; redoBtn.disabled = !redo.length; }
    function doUndo() { if (!undo.length) return; redo.push(snapshot()); pctx.putImageData(undo.pop(), 0, 0); redraw(); steps(); }
    function doRedo() { if (!redo.length) return; undo.push(snapshot()); pctx.putImageData(redo.pop(), 0, 0); redraw(); steps(); }
    undoBtn.onclick = doUndo; redoBtn.onclick = doRedo;

    function fit() {
      var maxW = stage.clientWidth - 24, maxH = stage.clientHeight - 24;
      var k = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
      fitW = Math.round(img.naturalWidth * k); fitH = Math.round(img.naturalHeight * k);
      frame.style.width = fitW + 'px'; frame.style.height = fitH + 'px';
      view.style.width = fitW + 'px'; view.style.height = fitH + 'px';
      setZoom(scale, null);
    }
    // Масштаб вокруг точки (в координатах сцены); без точки — вокруг центра.
    function setZoom(next, at) {
      next = Math.max(1, Math.min(8, next));
      var cx = at ? at.x : stage.clientWidth / 2, cy = at ? at.y : stage.clientHeight / 2;
      var baseX = (stage.clientWidth - fitW) / 2, baseY = (stage.clientHeight - fitH) / 2;
      // Точка под курсором остаётся на месте.
      var px = (cx - baseX - tx) / scale, py = (cy - baseY - ty) / scale;
      scale = next;
      tx = cx - baseX - px * scale; ty = cy - baseY - py * scale;
      clampPan(); apply();
      zoom.value = scale.toFixed(1); zoomOut.textContent = '×' + scale.toFixed(1);
    }
    function clampPan() {
      var extraW = fitW * (scale - 1), extraH = fitH * (scale - 1);
      tx = Math.min(extraW / 2 + 40, Math.max(-extraW / 2 - 40, tx));
      ty = Math.min(extraH / 2 + 40, Math.max(-extraH / 2 - 40, ty));
      if (scale === 1) { tx = 0; ty = 0; }
    }
    function apply() { frame.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')'; }
    function redraw() {
      vctx.clearRect(0, 0, view.width, view.height);
      vctx.drawImage(img, 0, 0);
      vctx.save(); vctx.globalAlpha = 0.45; vctx.drawImage(paint, 0, 0); vctx.restore();
    }
    function pos(e) {
      var r = view.getBoundingClientRect();
      return { x: (e.clientX - r.left) * view.width / r.width, y: (e.clientY - r.top) * view.height / r.height };
    }
    function radius() { return Number(size.value) / 100 * Math.min(view.width, view.height) / 2; }
    function sizeText() { sizeOut.textContent = Math.max(1, Math.round(radius() * 2)) + ' px'; }
    function stroke(a, b) {
      pctx.save();
      pctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over';
      pctx.strokeStyle = '#ff00c8'; pctx.fillStyle = '#ff00c8';
      pctx.lineWidth = Math.max(1, radius() * 2); pctx.lineCap = 'round'; pctx.lineJoin = 'round';
      pctx.beginPath(); pctx.moveTo(a.x, a.y); pctx.lineTo(b.x, b.y); pctx.stroke();
      pctx.restore();
    }
    function stagePoint(e) { var r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

    stage.onpointerdown = function (e) {
      if (e.button === 2 || e.button === 1 || (e.button === 0 && space)) {
        panning = { x: e.clientX - tx, y: e.clientY - ty }; stage.setPointerCapture(e.pointerId); e.preventDefault(); return;
      }
      if (e.button !== 0 || e.target !== view) return;
      remember();
      drawing = true; last = pos(e); stroke(last, last); redraw(); stage.setPointerCapture(e.pointerId); e.preventDefault();
    };
    stage.onpointermove = function (e) {
      if (panning) { tx = e.clientX - panning.x; ty = e.clientY - panning.y; clampPan(); apply(); return; }
      if (!drawing) return;
      var p = pos(e); stroke(last, p); last = p; redraw();
    };
    stage.onpointerup = stage.onpointercancel = function () { drawing = false; last = null; panning = null; };
    stage.oncontextmenu = function (e) { e.preventDefault(); };
    stage.onwheel = function (e) {
      e.preventDefault();
      var k = Math.pow(1.15, -e.deltaY / 100);
      setZoom(scale * k, stagePoint(e));
    };
    zoom.oninput = function () { setZoom(Number(zoom.value), null); };
    size.oninput = sizeText;
    brush.onclick = function () { erasing = false; brush.setAttribute('aria-pressed', 'true'); eraser.setAttribute('aria-pressed', 'false'); };
    eraser.onclick = function () { erasing = true; brush.setAttribute('aria-pressed', 'false'); eraser.setAttribute('aria-pressed', 'true'); };
    clear.onclick = function () { remember(); pctx.clearRect(0, 0, paint.width, paint.height); redraw(); };
    function close() { overlay.remove(); document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onKeyUp); window.removeEventListener('resize', fit); }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); cancel.click(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); }
      else if (e.key === ' ') { space = true; e.preventDefault(); }
      else if (e.key === '[') { size.value = Math.max(0.3, Number(size.value) - 0.5); sizeText(); }
      else if (e.key === ']') { size.value = Math.min(30, Number(size.value) + 0.5); sizeText(); }
      else if (e.key === '+' || e.key === '=') { setZoom(scale * 1.25, null); }
      else if (e.key === '-') { setZoom(scale / 1.25, null); }
      else if (e.key === '0') { setZoom(1, null); }
    }
    function onKeyUp(e) { if (e.key === ' ') space = false; }
    cancel.onclick = function () { close(); if (opts.onCancel) opts.onCancel(); };
    done.onclick = function () {
      // Маска: чёрный фон, белое — закрашенное. Считаем долю площади.
      var out = document.createElement('canvas'); out.width = paint.width; out.height = paint.height;
      var octx = out.getContext('2d');
      var data = pctx.getImageData(0, 0, paint.width, paint.height).data, covered = 0;
      var maskImg = octx.createImageData(paint.width, paint.height);
      for (var i = 0; i < data.length; i += 4) {
        var v = data[i + 3] > 40 ? 255 : 0; if (v) covered++;
        maskImg.data[i] = maskImg.data[i + 1] = maskImg.data[i + 2] = v; maskImg.data[i + 3] = 255;
      }
      octx.putImageData(maskImg, 0, 0);
      var pct = Math.round(100 * covered / (paint.width * paint.height));
      if (!covered) { hint.textContent = 'Ничего не закрашено: отметьте область или нажмите «Отмена».'; return; }
      close(); opts.onDone(out.toDataURL('image/png'), pct);
    };
    img.onload = function () {
      paint.width = view.width = img.naturalWidth; paint.height = view.height = img.naturalHeight;
      if (opts.initial) { var m = new Image(); m.onload = function () { pctx.drawImage(m, 0, 0); redraw(); }; m.src = opts.initial; }
      fit(); redraw(); sizeText();
      document.addEventListener('keydown', onKey); document.addEventListener('keyup', onKeyUp); window.addEventListener('resize', fit);
    };
    img.src = opts.src;
  }
  return { open: open };
})();
