h = BACommunity::Stultus::History.load
r = h.select { |m| m['render'] }.last
File.write('C:/work/maksar-ruslan/staltus/build/render_check.txt', "render.prompt=#{r && r['render']['prompt']}\nlast=#{(h.last['text'] || '')[0, 500]}")
