# Проверка снимков с явной камерой: iso/top/front, результат в build/shot_<вид>.png.
load 'C:/work/maksar-ruslan/staltus/src/stultus/screenshot.rb'
require 'base64'
report = []
view = Sketchup.active_model.active_view
before = view.camera.eye.to_a.map { |v| v.to_mm.round }
%w[iso top front].each do |v|
  r = BACommunity::Stultus::Screenshot.take(view_name: v, width: 800, height: 500)
  if r[:ok]
    File.binwrite("C:/work/maksar-ruslan/staltus/build/shot_#{v}.png", Base64.decode64(r[:base64]))
    report << "#{v}: ok #{r[:bytes]} b"
  else
    report << "#{v}: FAIL #{r[:error]}"
  end
end
after = view.camera.eye.to_a.map { |v| v.to_mm.round }
report << "camera restored: #{before == after} #{before.inspect} -> #{after.inspect}"
File.write('C:/work/maksar-ruslan/staltus/build/live_shot_report.txt', report.join("\n"))
