r = []
begin
  r << "Enscape class=#{Enscape.class} constants=#{Enscape.constants.inspect}"
  r << "singleton methods=#{Enscape.singleton_methods.sort.inspect}"
  r << "instance methods(false)=#{(Enscape.instance_methods(false) rescue []).inspect}"
  Enscape.constants.each do |c|
    v = Enscape.const_get(c)
    r << "  #{c}: #{v.class} #{v.is_a?(Module) ? 'methods=' + v.singleton_methods.sort.inspect + ' consts=' + v.constants.inspect : v.inspect[0, 120]}"
  end
  # Команды и панели, зарегистрированные всеми плагинами (чистый Ruby)
  cmds = []
  ObjectSpace.each_object(UI::Command) { |c| cmds << (c.menu_text rescue '?') }
  r << "UI::Command total=#{cmds.length}; enscape-like=#{cmds.grep(/enscape/i).uniq.inspect}"
  r << "vray-like=#{cmds.grep(/v-?ray|render|vfb|chaos/i).uniq.first(40).inspect}"
  tbs = []
  ObjectSpace.each_object(UI::Toolbar) { |t| tbs << (t.name rescue '?') }
  r << "toolbars=#{tbs.uniq.inspect}"
rescue => e
  r << "ERROR #{e.class}: #{e.message}"
end
File.write('C:/work/maksar-ruslan/staltus/build/kb/e01_reflect.txt', r.join("\n"))
