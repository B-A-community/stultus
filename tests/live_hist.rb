h = BACommunity::Stultus::History.load
out = h.last(12).map { |m| "#{m['at']} #{m['role']}: #{(m['text'] || '')[0, 400].gsub("\n", ' ')} tools=#{(m['tools'] || []).map { |t| "#{t['name']}:#{t['ok']}" }.inspect} render=#{m['render'].inspect}" }
File.write('C:/work/maksar-ruslan/staltus/build/hist.txt', out.join("\n"))
