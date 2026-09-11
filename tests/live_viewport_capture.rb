# Read-only verification: no camera setters, no geometry writes, no selection changes.
require 'json'
require 'base64'
load 'C:/work/maksar-ruslan/staltus/src/stultus/screenshot.rb'
model = Sketchup.active_model
view = model.active_view
state = lambda do
  camera = view.camera
  { eye: camera.eye.to_a, target: camera.target.to_a, up: camera.up.to_a,
    perspective: camera.perspective?, aspect: camera.aspect_ratio,
    lens: camera.perspective? ? camera.fov : camera.height,
    two_point: camera.is_2d?, scale: camera.scale_2d,
    selection: model.selection.map(&:entityID).sort,
    entities: model.active_entities.map(&:entityID).sort }
end
before = state.call
result = BACommunity::Stultus::Screenshot.capture_current
after = state.call
report = { ok: result[:ok], error: result[:error], camera_and_model_unchanged: before == after,
           image: [result[:width], result[:height]], viewport: [view.vpwidth, view.vpheight] }
if result[:ok]
  File.binwrite('C:/work/maksar-ruslan/staltus/build/viewport-source.png', Base64.strict_decode64(result[:base64]))
end
File.write('C:/work/maksar-ruslan/staltus/build/viewport-capture-report.json', JSON.pretty_generate(report))
