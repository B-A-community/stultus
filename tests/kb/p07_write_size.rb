r = []
begin
  s = VRay::Context.active.scene
  out = s['/SettingsOutput']
  w0, h0 = out[:img_width], out[:img_height]
  s.change { out[:img_width] = 640; out[:img_height] = 360 }
  r << "after change: #{out[:img_width]}x#{out[:img_height]} (was #{w0}x#{h0})"
  s.change { out[:img_width] = w0; out[:img_height] = h0 }
  r << "restored: #{out[:img_width]}x#{out[:img_height]}"
rescue => e
  r << "ERROR #{e.class}: #{e.message}"
end
File.write('C:/work/maksar-ruslan/staltus/build/kb/p07_write_size.txt', r.join("\n"))
