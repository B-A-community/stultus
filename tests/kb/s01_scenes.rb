load 'C:/work/maksar-ruslan/staltus/src/stultus/scenes.rb'
S = BACommunity::Stultus::Scenes
r = []
r << "list: #{S.run('list').inspect[0, 300]}"
r << "add: #{S.run('add', name: 'Stultus тест', description: 'проба').slice(:ok, :added, :error).inspect}"
r << "add dup: #{S.run('add', name: 'Stultus тест')[:error]}"
r << "activate: #{S.run('activate', name: 'stultus тест').slice(:ok, :activated).inspect}"
r << "update: #{S.run('update', name: 'Stultus тест').inspect}"
r << "missing: #{S.run('activate', name: 'нет такой')[:error]}"
r << "delete: #{S.run('delete', name: 'Stultus тест').slice(:ok, :deleted).inspect}; left=#{S.list[:scenes].length}"
File.write('C:/work/maksar-ruslan/staltus/build/kb/s01_scenes.txt', r.join("\n"))
