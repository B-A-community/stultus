# Живая загрузка плагина в запущенный SketchUp через мост :8080 (без перезапуска).
# Отчёт пишется в файл: load по мосту возвращает true, а не значение скрипта.
report = []
begin
  load 'C:/work/maksar-ruslan/staltus/src/stultus.rb'
  report << "registrar: ok, version #{BACommunity::Stultus::VERSION}"
  report << "modules: #{%w[Settings History Scene Runner Screenshot Dialog].map { |m| BACommunity::Stultus.const_defined?(m) }.inspect}"
  s = BACommunity::Stultus::Settings.update('gateway' => 'ws://127.0.0.1:8790/ws', 'token' => 'test-token')
  report << "settings: #{s.inspect}"
  snap = BACommunity::Stultus::Scene.snapshot
  report << "scene: title=#{snap[:title]} units=#{snap[:units].inspect} objects=#{snap[:objects_total]} counts=#{snap[:counts].inspect}"
  r = BACommunity::Stultus::Runner.execute("puts 'hi'; Sketchup.active_model.entities.length", label: 'тест')
  report << "runner ok: #{r.inspect}"
  r2 = BACommunity::Stultus::Runner.execute("raise 'boom'")
  report << "runner err: #{r2[:ok]} #{r2[:error]}"
  r3 = BACommunity::Stultus::Runner.execute("def (")
  report << "runner syntax: #{r3[:ok]} #{r3[:error][0,60]}"
  n = BACommunity::Stultus::History.save([{ 'role' => 'user', 'text' => 'привет' }, { 'role' => 'assistant', 'text' => 'ok', 'tools' => [] }])
  report << "history saved=#{n} loaded=#{BACommunity::Stultus::History.load.inspect}"
  big = (1..5000).map { |i| { 'role' => 'user', 'text' => 'x' * 100 + i.to_s } }
  n2 = BACommunity::Stultus::History.save(big)
  report << "history cap: kept #{n2} of 5000, bytes=#{BACommunity::Stultus::History.read('history').bytesize}"
  BACommunity::Stultus::History.save_sessions('claude' => 'abc')
  report << "sessions: #{BACommunity::Stultus::History.sessions.inspect}"
  BACommunity::Stultus::History.clear
  report << "cleared: #{BACommunity::Stultus::History.load.length} #{BACommunity::Stultus::History.sessions.inspect}"
  shot = BACommunity::Stultus::Screenshot.take(view_name: 'iso', zoom_extents: true, width: 400, height: 300)
  report << "screenshot: ok=#{shot[:ok]} bytes=#{shot[:bytes]} err=#{shot[:error]}"
  BACommunity::Stultus.open
  report << "dialog opened: #{BACommunity::Stultus::Dialog.instance_variable_get(:@dialog).class}"
rescue Exception => e
  report << "FAIL #{e.class}: #{e.message}\n#{e.backtrace.first(6).join("\n")}"
end
File.write('C:/work/maksar-ruslan/staltus/build/live_load_report.txt', report.join("\n"))
