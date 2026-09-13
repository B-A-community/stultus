r = []
begin
  s = VRay::Context.active.scene
  out = s['/SettingsOutput']
  r << "scene['/SettingsOutput'] => #{out.class} valid=#{out && out.valid?} name=#{out && out.name} type=#{out && out.type.inspect}"
rescue => e
  r << "ERROR #{e.class}: #{e.message}"
end
File.write('C:/work/maksar-ruslan/staltus/build/kb/p04_output_lookup.txt', r.join("\n"))
