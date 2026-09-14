load 'C:/work/maksar-ruslan/staltus/src/stultus/runner.rb'
R = BACommunity::Stultus::Runner
r = []
t = Time.now
res = R.execute("x = 0\nloop { x += 1 }", label: 'бесконечный цикл', timeout: 3)
r << "loop: ok=#{res[:ok]} timed_out=#{res[:timed_out]} seconds=#{res[:seconds]} wall=#{(Time.now - t).round(1)} err=#{res[:error].to_s[0, 60]}"
t = Time.now
res = R.execute("Dir.glob('C:/Users/**/*.png').length", label: 'поиск по диску', timeout: 3)
r << "glob: ok=#{res[:ok]} timed_out=#{res[:timed_out]} wall=#{(Time.now - t).round(1)}"
res = R.execute("sleep 0.5; 42", label: 'быстрый', timeout: 3)
r << "fast: ok=#{res[:ok]} result=#{res[:result]} seconds=#{res[:seconds]}"
# прозрачные операции: два вызова — один пункт Undo?
m = Sketchup.active_model
n0 = m.entities.length
R.execute("g = Sketchup.active_model.entities.add_group; g.entities.add_face([0,0,0],[100.mm,0,0],[100.mm,100.mm,0],[0,100.mm,0]); g.name='undo_test_1'", label: 'Ход: тест undo', transparent: false)
R.execute("g = Sketchup.active_model.entities.add_group; g.entities.add_face([200.mm,0,0],[300.mm,0,0],[300.mm,100.mm,0],[200.mm,100.mm,0]); g.name='undo_test_2'", label: 'вторая часть', transparent: true)
n1 = m.entities.length
Sketchup.undo
n2 = m.entities.length
r << "undo: before=#{n0} after two calls=#{n1} after ONE undo=#{n2} (ожидание: #{n0})"
File.write('C:/work/maksar-ruslan/staltus/build/kb/t01_timeout.txt', r.join("\n"))
