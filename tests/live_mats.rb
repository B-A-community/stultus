m = Sketchup.active_model
File.write('C:/work/maksar-ruslan/staltus/build/mats.txt', m.entities.grep(Sketchup::Group).map { |g| "#{g.name}: #{g.material && g.material.name}" }.join("\n"))
