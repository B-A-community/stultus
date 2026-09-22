# Что стало с массингом после правки по панорамам.
m = Sketchup.active_model
top = m.entities.grep(Sketchup::Group).find { |g| g.name.start_with?('Массинг') }
out = { top: top && top.name, count: top ? top.entities.grep(Sketchup::Group).length : 0, changed: [] }
if top
  top.entities.grep(Sketchup::Group).each do |g|
    src = g.get_attribute('stultus_massing', 'heightSource').to_s
    note = g.attribute_dictionary('stultus_massing') ? g.attribute_dictionary('stultus_massing').to_h.reject { |k, _| %w[id type name address levels height minHeight heightSource area distance].include?(k) } : {}
    next unless src != 'levels' && src != 'height'
    out[:changed] << {
      name: g.name,
      z_m: (g.bounds.depth.to_m).round(2),
      attrs: { levels: g.get_attribute('stultus_massing', 'levels'), height: g.get_attribute('stultus_massing', 'height'), source: src },
      extra: note
    }
  end
end
File.write('C:/work/maksar-ruslan/staltus/build/massing_fix.json', out.to_json)
out[:changed].length
