# Список плагинов-настроек в сцене: имя и тип. Только чтение, без параметров.
r = []
begin
  s = VRay::Context.active.scene
  names = []
  s.each { |p| names << [p.name, p.type, p.category] }
  r << "plugins total=#{names.length}"
  r << "categories=#{names.map { |_, _, c| c }.tally.inspect}"
  r << "settings:"
  names.select { |_, _, c| c == :settings }.each { |n, t, _| r << "  #{n}  (#{t})" }
  r << "output-like: " + names.select { |n, _, _| n =~ /Output|Camera|Image|Resolution/i }.map(&:first).inspect
rescue => e
  r << "ERROR #{e.class}: #{e.message}"
end
File.write('C:/work/maksar-ruslan/staltus/build/kb/p03_scene_settings.txt', r.join("\n"))
