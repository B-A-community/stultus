r = []
Sketchup.extensions.each do |e|
  next unless e.name =~ /ray|enscape/i
  r << "#{e.name}: path=#{e.extension_path.inspect} id=#{e.id} creator=#{e.creator}"
end
r << "$LOADED_FEATURES vray/enscape: " + $LOADED_FEATURES.grep(/vray|enscape|chaos/i).first(40).join("\n  ")
File.write('C:/work/maksar-ruslan/staltus/build/kb/paths.txt', r.join("\n"))
