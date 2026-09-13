%w[history dialog].each { |f| load "C:/work/maksar-ruslan/staltus/src/stultus/#{f}.rb" }
H = BACommunity::Stultus::History
r = []
n0 = H.load.length; s0 = H.sessions
r << "before: #{n0} msgs, sessions=#{s0.keys.inspect}, archive=#{H.archive_info.inspect}"
c = H.clear
r << "clear: #{c.inspect}; now #{H.load.length} msgs, sessions=#{H.sessions.inspect}, archive=#{H.archive_info.inspect}"
H.save([{ 'role' => 'user', 'text' => 'новое после удаления' }])
rs = H.restore
r << "restore: restored=#{rs[:restored]} total=#{rs[:messages].length} sessions=#{rs[:sessions].keys.inspect} archive=#{H.archive_info.inspect}"
r << "last msg is new one: #{H.load.last['text']}"
# убираем тестовое сообщение
H.save(H.load[0...-1])
r << "after cleanup: #{H.load.length} (expected #{n0})"
File.write('C:/work/maksar-ruslan/staltus/build/archive_report.txt', r.join("\n"))
