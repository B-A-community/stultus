# Параметры /SettingsOutput через dump — тот же метод, что модель уже безопасно звала на других плагинах.
r = []
begin
  out = VRay::Context.active.scene['/SettingsOutput']
  r << out.dump.to_s.gsub("\x00", '')
rescue => e
  r << "ERROR #{e.class}: #{e.message}"
end
File.write('C:/work/maksar-ruslan/staltus/build/kb/p05_output_dump.txt', r.join("\n"))
