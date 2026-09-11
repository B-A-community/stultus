# Проверка выделения: модули, наблюдатель, описание, инструмент select.
# Отчёт — build/live_selection_report.txt.
%w[scene selection dialog main].each { |f| load "C:/work/maksar-ruslan/staltus/src/stultus/#{f}.rb" }
r = []
m = Sketchup.active_model
S = BACommunity::Stultus

# Тестовая сцена: компонент «Окно 1200» × 6 экземпляров и одна группа «Стена».
m.start_operation('Stultus test: окна', true)
old = m.entities.select { |e| (e.is_a?(Sketchup::ComponentInstance) && e.definition.name == 'Окно 1200') || (e.is_a?(Sketchup::Group) && e.name == 'Стена') }
m.entities.erase_entities(old) unless old.empty?
defn = m.definitions['Окно 1200'] || m.definitions.add('Окно 1200')
if defn.entities.length.zero?
  f = defn.entities.add_face([0, 0, 0], [1200.mm, 0, 0], [1200.mm, 0, 1500.mm], [0, 0, 1500.mm])
  f.reverse! if f.normal.y > 0
  f.pushpull(80.mm)
end
6.times { |i| m.entities.add_instance(defn, Geom::Transformation.new([(i * 2000).mm, 3000.mm, 900.mm])) }
wall = m.entities.add_group
wf = wall.entities.add_face([0, 3000.mm, 0], [12000.mm, 3000.mm, 0], [12000.mm, 3000.mm, 3000.mm], [0, 3000.mm, 3000.mm])
wf.pushpull(-200.mm)
wall.name = 'Стена'
m.commit_operation
wins = m.entities.grep(Sketchup::ComponentInstance).select { |e| e.definition.name == 'Окно 1200' }
r << "scene: #{wins.length} windows, wall=#{wall.entityID}"

# Описание выделения
m.selection.clear; m.selection.add(wins[2])
sum = S::Selection.summary
r << "one window: #{sum[:text]} | defs=#{sum[:definitions].inspect}"
snap = S::Scene.snapshot(full: false)
r << "snapshot(full:false) keys=#{snap.keys.inspect}"
r << "selection[0]=#{snap[:selection][0].inspect}"
m.selection.add(wins[0], wins[1])
r << "three windows: #{S::Selection.text_for(m.selection.to_a)}"
m.selection.clear; m.selection.add(wall)
r << "wall: #{S::Selection.text_for(m.selection.to_a)}"
m.selection.clear; m.selection.add(wall.entities.grep(Sketchup::Face).first)
r << "face (outside context): #{S::Scene.describe(m.selection[0], detailed: true).inspect}"
m.selection.clear; m.selection.add(*wins, wall)
r << "all: #{S::Selection.text_for(m.selection.to_a)}"
r << "plural: #{[1,2,5,11,21,22,25].map { |n| S::Selection.plural(n, 'грань', 'грани', 'граней') }.join('; ')}"

# Инструмент select
res = S::Selection.select([wins[1].entityID, wins[4].entityID, 999999999], mode: 'replace', zoom: true)
r << "select: #{res.inspect}"
res = S::Selection.select([wall.entityID], mode: 'add')
r << "select add: #{res[:text]} selected=#{res[:selected]}"
res = S::Selection.select([], mode: 'clear')
r << "select clear: #{res.inspect}"
res = S::Selection.select([wf.entityID], mode: 'replace')
r << "select face inside group from root: #{res.inspect}"

# Окно с наблюдателем
d = S::Dialog.instance_variable_get(:@dialog)
d.close if d
S.open
r << "dialog reopened; observer attached=#{!S::Selection.instance_variable_get(:@observer).nil?}"
File.write('C:/work/maksar-ruslan/staltus/build/live_selection_report.txt', r.join("\n"))
