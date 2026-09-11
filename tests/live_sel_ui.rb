load 'C:/work/maksar-ruslan/staltus/src/stultus/scene.rb'
S = BACommunity::Stultus
m = Sketchup.active_model
ws = m.entities.grep(Sketchup::ComponentInstance).select { |e| e.definition.name == 'Окно 1200' }
wall = m.entities.grep(Sketchup::Group).find { |g| g.name == 'Стена' }
step = File.read('C:/work/maksar-ruslan/staltus/build/sel_step.txt').strip
m.selection.clear
case step
when '1' then m.selection.add(ws[2])
when '2' then m.selection.add(ws[1], ws[2], ws[3], wall)
when '3' then m.selection.add(wall.entities.grep(Sketchup::Face).first(2))
end
File.write('C:/work/maksar-ruslan/staltus/build/live_sel_ui_report.txt',
  "step #{step}: size=#{S::Scene.describe(ws[0])[:bounds_mm][:size].inspect} observer=#{!S::Selection.instance_variable_get(:@observer).nil?} text=#{S::Selection.text_for(m.selection.to_a)}")
