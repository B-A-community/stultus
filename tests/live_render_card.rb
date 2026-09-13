# Локальная проверка карточки постпродакшна без gateway: подсовываем окну
# tool_call render_viewport и жмём «Изменить». Отчёт — build/render_card_report.txt.
%w[render_assets screenshot dialog].each { |f| load "C:/work/maksar-ruslan/staltus/src/stultus/#{f}.rb" }
S = BACommunity::Stultus
d = S::Dialog.instance_variable_get(:@dialog)
d.close if d
S.open
d = S::Dialog.instance_variable_get(:@dialog)
d.add_action_callback('probe') { |_c, s| File.write('C:/work/maksar-ruslan/staltus/build/render_card_report.txt', s.to_s) }
step = File.read('C:/work/maksar-ruslan/staltus/build/sel_step.txt').strip
js = case step
when 'card'
  <<~JS
    (function(){
      // Перехват отправки в gateway: записываем, что ушло бы.
      window.__sent = [];
      var ws = { readyState: 1, send: function(s){ window.__sent.push(JSON.parse(s)); } };
      var call = { type:'tool_call', call_id:'c1', name:'render_viewport', args:{ render_id:'r1', prompt:'Сделать качественную архитектурную визуализацию текущего вида SketchUp, строго сохранив ракурс. Дневной свет, светлый бетон.' } };
      // Достаём handle через onmessage окна: имитируем сообщение gateway.
      var evt = new MessageEvent('message', { data: JSON.stringify(call) });
      if (window.__hook) window.__hook(evt); else { window.__pendingCall = call; }
      var b = [].slice.call(document.querySelectorAll('.card--render .card__options button')).map(function(x){ return x.textContent + (x.hidden?'(hidden)':''); });
      sketchup.probe(JSON.stringify({ buttons: b }));
    })();
  JS
end
UI.start_timer(2.5, false) { d.execute_script(js) } if js
