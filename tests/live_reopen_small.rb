# Переоткрыть окно и сжать до минимума — проверка узкой раскладки.
%w[constants dialog].each { |f| load "C:/work/maksar-ruslan/staltus/src/stultus/#{f}.rb" }
d = BACommunity::Stultus::Dialog.instance_variable_get(:@dialog)
d.close if d
BACommunity::Stultus.open
d = BACommunity::Stultus::Dialog.instance_variable_get(:@dialog)
UI.start_timer(1.5, false) { d.set_size(380, 460) }
