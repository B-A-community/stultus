m = Sketchup.active_model
n1 = m.entities.length
pages = m.pages.map(&:name)
Sketchup.undo
n2 = m.entities.length
pages2 = m.pages.map(&:name)
File.write('C:/work/maksar-ruslan/staltus/build/undo_check.txt', "entities after turn=#{n1}, after ONE undo=#{n2}; pages before undo=#{pages.inspect}, after=#{pages2.inspect}")
