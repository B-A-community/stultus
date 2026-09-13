load 'C:/work/maksar-ruslan/staltus/src/stultus/vray.rb'
M = BACommunity::Stultus::VRayRender
File.write('C:/work/maksar-ruslan/staltus/build/kb/v10_module.txt', "available=#{M.available?} version=#{M.version.inspect} state=#{M.state.inspect}\n")
t0 = Time.now
M.render(width: 480, height: 270, preset: 'draft', timeout: 120) do |res|
  line = res[:ok] ? "ok #{res[:width]}x#{res[:height]} bytes=#{res[:bytes]} state=#{res[:state]} seconds=#{res[:seconds]}" : "FAIL #{res[:error]} state=#{res[:state]}"
  File.open('C:/work/maksar-ruslan/staltus/build/kb/v10_module.txt', 'a') { |f| f.puts(line) }
  File.binwrite('C:/work/maksar-ruslan/staltus/build/kb/v10_render.png', Base64.strict_decode64(res[:base64])) if res[:ok]
  out = VRay::Context.active.scene['/SettingsOutput']; smp = VRay::Context.active.scene['/SettingsImageSampler']
  File.open('C:/work/maksar-ruslan/staltus/build/kb/v10_module.txt', 'a') { |f| f.puts("restored: #{out[:img_width]}x#{out[:img_height]} maxSubdivs=#{smp[:progressive_maxSubdivs]} threshold=#{smp[:progressive_threshold]}") }
end
