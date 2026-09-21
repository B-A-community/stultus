# Выполнить JS из файла, путь в build/jsfile.txt; вывод — через Stultus.log.
d = BACommunity::Stultus::Dialog.instance_variable_get(:@dialog)
path = File.read('C:/work/maksar-ruslan/staltus/build/jsfile.txt', encoding: 'utf-8').strip
d.execute_script("try{" + File.read(path, encoding: 'utf-8') + "}catch(e){Stultus.log('ERR '+e.message+' '+e.stack)}")
