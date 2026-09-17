# Переключить окно на другой gateway: адрес и пропуск из build/switch.txt (две строки), затем переоткрыть окно.
lines = File.read('C:/work/maksar-ruslan/staltus/build/switch.txt', encoding: 'utf-8').lines.map(&:strip)
BACommunity::Stultus::Settings.update('gateway' => lines[0], 'token' => lines[1])
load 'C:/work/maksar-ruslan/staltus/tests/live_reopen.rb'
