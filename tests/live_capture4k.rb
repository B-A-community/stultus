# Проверка: снимок вьюпорта в 3840 по ширине против framebuffer — совпадает ли кадрирование.
view = Sketchup.active_model.active_view
vw, vh = view.vpwidth, view.vpheight
dir = 'C:/work/maksar-ruslan/staltus/build'
lines = ["viewport: #{vw}x#{vh}"]
view.refresh
a = File.join(dir, 'cap_fb.png')
ok1 = view.write_image(filename: a, source: :framebuffer)
w = 3840; h = (w * vh / vw.to_f).round
b = File.join(dir, 'cap_4k.png')
t = Time.now
ok2 = view.write_image(filename: b, width: w, height: h, antialias: true, compression: 0.9)
lines << "framebuffer: #{ok1} #{File.size(a) rescue 'x'}"
lines << "4k: #{ok2} #{File.size(b) rescue 'x'} за #{(Time.now - t).round(2)} с"
c = File.join(dir, 'cap_4k_fb.png')
ok3 = (view.write_image(filename: c, width: w, height: h, source: :framebuffer) rescue "ERR #{$!.class}: #{$!.message}")
lines << "4k+framebuffer: #{ok3.inspect} #{File.size(c) rescue 'x'}"
File.write(File.join(dir, 'capture4k_report.txt'), lines.join("\n"))
