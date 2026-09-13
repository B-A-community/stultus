r = []
begin
  out = VRay::Context.active.scene['/SettingsOutput']
  r << "img_width=#{out[:img_width].inspect} img_height=#{out[:img_height].inspect} img_file=#{out[:img_file].inspect} img_dir=#{out[:img_dir].inspect}"
  # each по документации: |param_name, param_value, user_data, file_path|
  n = 0; sample = []
  out.each { |name, value, ud, fp| n += 1; sample << [name, value, ud, fp] if sample.length < 4 }
  r << "each yielded #{n} params; sample=#{sample.inspect}"
rescue => e
  r << "ERROR #{e.class}: #{e.message}"
end
File.write('C:/work/maksar-ruslan/staltus/build/kb/p06_read_symbol.txt', r.join("\n"))
