# Разведка окружения без вызовов в сторонние плагины: что установлено, версии.
r = []
m = Sketchup.active_model
r << "sketchup=#{Sketchup.version} model=#{m.title.inspect} path=#{m.path.inspect} modified=#{m.modified?} entities=#{m.entities.length}"
exts = Sketchup.extensions.map { |e| [e.name, e.version, e.loaded?] }
r << "extensions: " + exts.select { |n, _, _| n =~ /ray|enscape|chaos/i }.map { |n, v, l| "#{n} #{v} loaded=#{l}" }.join(' | ')
r << "VRay defined=#{defined?(VRay).inspect} Enscape defined=#{defined?(Enscape).inspect}"
r << "top consts matching: " + Object.constants.grep(/vray|enscape|chaos/i).inspect
plug = File.join(ENV['APPDATA'], 'SketchUp/SketchUp 2024/SketchUp/Plugins')
r << "plugins dir entries: " + Dir.children(plug).grep(/ray|enscape|chaos/i).inspect
r << "program files: " + Dir.glob('C:/Program Files/{Chaos*,Enscape*,Chaos Group}/*').first(10).inspect
File.write('C:/work/maksar-ruslan/staltus/build/kb/env.txt', r.join("\n"))
