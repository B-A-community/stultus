# Состояние модели и переписки после хода — отчёт в build/live_check_report.txt.
m = Sketchup.active_model
g = m.entities.grep(Sketchup::Group).find { |x| x.name == 'Тестовый куб' }
h = BACommunity::Stultus::History.load
lines = []
lines << "cube: #{g ? [g.bounds.min.to_a.map { |v| v.to_mm.round }, g.material && g.material.name, g.material && g.material.color.to_a].inspect : 'none'}"
lines << "history: #{h.length} messages; sessions: #{BACommunity::Stultus::History.sessions.inspect}"
h.last(3).each { |x| lines << "- #{x['role']}: #{(x['text'] || '')[0, 300].gsub("\n", ' ')} tools=#{(x['tools'] || []).map { |t| "#{t['name']}:#{t['ok']}" }.inspect}" }
File.write('C:/work/maksar-ruslan/staltus/build/live_check_report.txt', lines.join("\n"))
