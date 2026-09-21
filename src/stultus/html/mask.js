/* Рисовалка области поверх кадра: кисть, ластик, очистить, готово.
   Маска отдаётся PNG в разрешении картинки: белое — менять, чёрное — оставить.
   Никакой сети, только canvas. */
window.StultusMask = (function () {
  'use strict';
  function element(tag, name, text) { var el = document.createElement(tag); el.className = name; if (text) el.textContent = text; return el; }

  // open({ src, initial?, onDone(maskDataUrl, coveragePercent), onCancel })
  function open(opts) {
    var overlay = element('div', 'mask');
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-label', 'Область для изменения');
    var stage = element('div', 'mask__stage');
    var img = new Image();
    var paint = document.createElement('canvas'); paint.className = 'mask__paint';
    var view = document.createElement('canvas'); view.className = 'mask__view';
    var bar = element('div', 'mask__bar');
    var hint = element('span', 'mask__hint', 'Закрасьте, что должно измениться. Остальное останется как есть.');
    var sizeLabel = element('label', 'mask__size', 'Кисть ');
    var size = document.createElement('input'); size.type = 'range'; size.min = 2; size.max = 30; size.value = 8; size.setAttribute('aria-label', 'Размер кисти');
    sizeLabel.appendChild(size);
    var brush = element('button', 'btn', 'Кисть'), eraser = element('button', 'btn', 'Ластик'), clear = element('button', 'btn', 'Очистить');
    var cancel = element('button', 'btn', 'Отмена'), done = element('button', 'btn btn--primary', 'Готово ↗');
    brush.setAttribute('aria-pressed', 'true'); eraser.setAttribute('aria-pressed', 'false');
    bar.appendChild(hint); bar.appendChild(sizeLabel); bar.appendChild(brush); bar.appendChild(eraser); bar.appendChild(clear); bar.appendChild(cancel); bar.appendChild(done);
    stage.appendChild(view); overlay.appendChild(stage); overlay.appendChild(bar);
    document.body.appendChild(overlay);

    var erasing = false, drawing = false, last = null;
    var pctx = paint.getContext('2d'), vctx = view.getContext('2d');
    function fit() {
      var maxW = overlay.clientWidth - 32, maxH = overlay.clientHeight - bar.offsetHeight - 40;
      var k = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
      view.style.width = Math.round(img.naturalWidth * k) + 'px';
      view.style.height = Math.round(img.naturalHeight * k) + 'px';
    }
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
    function stroke(a, b) {
      pctx.save();
      pctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over';
      pctx.strokeStyle = '#ff00c8'; pctx.fillStyle = '#ff00c8';
      pctx.lineWidth = radius() * 2; pctx.lineCap = 'round'; pctx.lineJoin = 'round';
      pctx.beginPath(); pctx.moveTo(a.x, a.y); pctx.lineTo(b.x, b.y); pctx.stroke();
      pctx.restore();
    }
    view.onpointerdown = function (e) { drawing = true; last = pos(e); stroke(last, last); redraw(); view.setPointerCapture(e.pointerId); e.preventDefault(); };
    view.onpointermove = function (e) { if (!drawing) return; var p = pos(e); stroke(last, p); last = p; redraw(); };
    view.onpointerup = view.onpointercancel = function () { drawing = false; last = null; };
    brush.onclick = function () { erasing = false; brush.setAttribute('aria-pressed', 'true'); eraser.setAttribute('aria-pressed', 'false'); };
    eraser.onclick = function () { erasing = true; brush.setAttribute('aria-pressed', 'false'); eraser.setAttribute('aria-pressed', 'true'); };
    clear.onclick = function () { pctx.clearRect(0, 0, paint.width, paint.height); redraw(); };
    function close() { overlay.remove(); document.removeEventListener('keydown', onKey); window.removeEventListener('resize', fit); }
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); cancel.click(); } }
    cancel.onclick = function () { close(); if (opts.onCancel) opts.onCancel(); };
    done.onclick = function () {
      // Маска: чёрный фон, белое — закрашенное. Считаем долю площади.
      var out = document.createElement('canvas'); out.width = paint.width; out.height = paint.height;
      var octx = out.getContext('2d');
      octx.fillStyle = '#000'; octx.fillRect(0, 0, out.width, out.height);
      octx.globalCompositeOperation = 'source-over';
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
      fit(); redraw();
      document.addEventListener('keydown', onKey); window.addEventListener('resize', fit);
    };
    img.src = opts.src;
  }
  return { open: open };
})();
