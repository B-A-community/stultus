# Выполнить JS из build/js.txt в окне; результат через sketchup.probe → build/js_out.txt
d = BACommunity::Stultus::Dialog.instance_variable_get(:@dialog)
d.add_action_callback('probe') { |_c, s| File.write('C:/work/maksar-ruslan/staltus/build/js_out.txt', s.to_s) }
d.execute_script(File.read('C:/work/maksar-ruslan/staltus/build/js.txt', encoding: 'utf-8'))
