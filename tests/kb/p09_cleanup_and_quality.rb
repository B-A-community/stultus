# Вернуть размер, отписаться; прочитать, чем задаётся качество (ImageSampler) и камера/вид (RenderView).
r = []
begin
  ctx = VRay::Context.active; s = ctx.scene; rd = ctx.renderer
  out = s['/SettingsOutput']
  s.change { out[:img_width], out[:img_height] = $kb_size } if $kb_size
  r << "size restored: #{out[:img_width]}x#{out[:img_height]}; state=#{rd.state}"
  rd.unsubscribe($kb_sub) if $kb_sub
  %w[/SettingsImageSampler /RenderView /SettingsCamera /SettingsGI /SettingsRTEngine].each do |n|
    p = s[n]; next unless p
    r << p.dump.to_s.gsub("\x00", '').lines.reject { |l| l =~ /userdata|ui_tags|^\s*$/ }.first(40).join
  end
rescue => e
  r << "ERROR #{e.class}: #{e.message}"
end
File.write('C:/work/maksar-ruslan/staltus/build/kb/p09_cleanup_and_quality.txt', r.join("\n"))
