# Переоткрыть окно (подхватить новые html/css/js с диска) и записать UserAgent CEF.
load 'C:/work/maksar-ruslan/staltus/src/stultus/main.rb'
d = BACommunity::Stultus::Dialog.instance_variable_get(:@dialog)
d.close if d
BACommunity::Stultus.open
d = BACommunity::Stultus::Dialog.instance_variable_get(:@dialog)
d.add_action_callback('dbg') { |_c, s| File.write('C:/work/maksar-ruslan/staltus/build/ua.txt', s.to_s) }
UI.start_timer(2.0, false) do
  d.execute_script("sketchup.dbg(navigator.userAgent + ' | state=' + document.getElementById('app').dataset.state + ' | inputDisabled=' + document.getElementById('input').disabled + ' | msgs=' + document.querySelectorAll('.msg').length)")
end
