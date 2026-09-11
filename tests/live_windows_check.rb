# Состояние окон: у каждого экземпляра — определение, высота, ширина; сколько определений «Окно*».
m = Sketchup.active_model
ws = m.entities.grep(Sketchup::ComponentInstance).select { |e| e.definition.name.start_with?('Окно') }
rows = ws.sort_by { |w| w.bounds.min.x }.map do |w|
  b = w.bounds
  "#{w.entityID} #{w.definition.name} inst=#{w.definition.count_instances} w=#{(b.max.x-b.min.x).to_mm.round} h=#{(b.max.z-b.min.z).to_mm.round} mat=#{w.material && w.material.name}"
end
h = BACommunity::Stultus::History.load
File.write('C:/work/maksar-ruslan/staltus/build/live_windows_report.txt',
  (rows + ["defs: #{m.definitions.map(&:name).select { |n| n.start_with?('Окно') }.inspect}", "sel: #{BACommunity::Stultus::Selection.text_for(m.selection.to_a)}", "last: #{(h.last['text'] || '')[0, 600]}"]).join("\n"))
