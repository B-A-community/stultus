# Проверка массинга: группа, здания, целевой дом, слой, материалы; снимок изометрии в build/.
m = Sketchup.active_model
top = m.entities.grep(Sketchup::Group).find { |g| g.name.start_with?('Массинг') }
out = {}
if top
  kids = top.entities.grep(Sketchup::Group)
  out[:top] = top.name
  out[:layer] = top.layer.name
  out[:count] = kids.length
  out[:materials] = kids.map { |g| g.material && g.material.name }.tally
  out[:faces] = top.entities.grep(Sketchup::Face).length + kids.sum { |g| g.entities.grep(Sketchup::Face).length }
  tgt = kids.find { |g| g.get_attribute('stultus_massing', 'address').to_s.include?('26 к1') }
  if tgt
    b = tgt.bounds
    out[:target] = { name: tgt.name, size_m: [b.width, b.height, b.depth].map { |v| (v.to_m).round(1) }, material: tgt.material && tgt.material.name, attrs: %w[levels height heightSource].map { |k| tgt.get_attribute('stultus_massing', k) } }
  end
  est = kids.select { |g| g.get_attribute('stultus_massing', 'heightSource') == 'estimate' }
  out[:estimated] = est.length
  out[:bounds_m] = [top.bounds.width.to_m.round, top.bounds.height.to_m.round, top.bounds.depth.to_m.round]
  out[:georef] = [m.shadow_info['Latitude'], m.shadow_info['Longitude']]
  m.selection.clear
  v = m.active_view
  v.camera = Sketchup::Camera.new(Geom::Point3d.new(-600.m, -700.m, 450.m), Geom::Point3d.new(0, 0, 0), Z_AXIS)
  v.zoom(top)
  v.write_image(filename: 'C:/work/maksar-ruslan/staltus/build/massing_iso.png', width: 1600, height: 1000, antialias: true)
end
File.write('C:/work/maksar-ruslan/staltus/build/massing_check.txt', out.to_json)
out.to_json
