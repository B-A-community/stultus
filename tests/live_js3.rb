# Выполнить JS из build/js.txt; вывод — через Stultus.log в %TEMP%/stultus_dialog.log
d = BACommunity::Stultus::Dialog.instance_variable_get(:@dialog)
d.execute_script("try{" + File.read('C:/work/maksar-ruslan/staltus/build/js.txt', encoding: 'utf-8') + "}catch(e){Stultus.log('ERR '+e.message)}")
