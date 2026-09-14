h = BACommunity::Stultus::History.load
File.write('C:/work/maksar-ruslan/staltus/build/last2.txt', h.last(2).map { |m| "#{m['role']}: #{(m['text'] || '')[0, 900]} att=#{(m['attachments'] || []).map { |a| a['path'] }.inspect}" }.join("\n---\n"))
