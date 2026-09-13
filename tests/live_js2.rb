d = BACommunity::Stultus::Dialog.instance_variable_get(:@dialog)
d.add_action_callback('probe2') { |_c, s| File.write('C:/work/maksar-ruslan/staltus/build/js_out.txt', s.to_s) }
UI.start_timer(0.3, false) do
  d.execute_script("try{" + File.read('C:/work/maksar-ruslan/staltus/build/js.txt', encoding: 'utf-8') + "}catch(e){sketchup.probe2('ERR '+e.message)}")
end
File.write('C:/work/maksar-ruslan/staltus/build/js2_ran.txt', Time.now.to_s)
