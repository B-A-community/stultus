h = BACommunity::Stultus::History.load
last = h.last(4)
File.write('C:/work/maksar-ruslan/staltus/build/last.txt', last.map { |m| "#{m['role']}: #{(m['text'] || '')[0, 700]} tools=#{(m['tools'] || []).map { |t| t['name'] + ':' + t['label'].to_s + ':' + t['ok'].to_s }.inspect}" }.join("\n---\n"))
