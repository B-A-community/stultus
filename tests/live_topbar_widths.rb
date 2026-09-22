# Шапка окна на разных ширинах: иконки должны оставаться в одной строке.
# Окно по очереди ставится в ширины из списка, в каждой меряется шапка,
# результат — строки «TOP …» в %TEMP%/stultus_dialog.log. Потом размер
# окна возвращается как был.
d = BACommunity::Stultus::Dialog.instance_variable_get(:@dialog)
orig = d.get_size
widths = [380, 400, 430, 470, 520, 700]
js = <<~JS
  (function(w){
    var t=document.querySelector('.topbar'), a=document.querySelector('.topbar__actions'), ti=document.querySelector('.topbar__title'), st=document.getElementById('connStatus');
    function r(e){ return e.getBoundingClientRect(); }
    var btns=[].slice.call(a.querySelectorAll('.iconbtn')).filter(function(b){ return b.offsetParent!==null; });
    var tops={}; btns.forEach(function(b){ tops[Math.round(r(b).top)]=1; });
    Stultus.log('TOP w='+w+' inner='+innerWidth+' шапка='+Math.round(r(t).height)+' строк_иконок='+Object.keys(tops).length+' верх_заголовка='+Math.round(r(ti).top)+' верх_иконок='+Math.round(r(a).top)+' текст_статуса='+getComputedStyle(st.querySelector('.topbar__statusText')).display+' вылезает_документ='+(document.documentElement.scrollWidth-document.documentElement.clientWidth)+' вылезает_шапка='+(t.scrollWidth-t.clientWidth)+' подсказка=«'+st.title+'»');
  })(__W__);
JS
step = lambda do |i|
  if i >= widths.length
    d.set_size(*orig)
    next
  end
  d.set_size(widths[i], 760)
  UI.start_timer(0.8, false) do
    d.execute_script(js.sub('__W__', widths[i].to_s))
    UI.start_timer(0.3, false) { step.call(i + 1) }
  end
end
step.call(0)
orig.inspect
