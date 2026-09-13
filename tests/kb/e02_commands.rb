r = []
begin
  r << "UI::Command instance methods=#{UI::Command.instance_methods(false).sort.inspect}"
  found = {}
  ObjectSpace.each_object(UI::Command) { |c| t = (c.menu_text rescue nil); found[t] = c if t =~ /^(Start Enscape|Render|Render Interactive|Batch Render|Viewport Render)$/ }
  found.each { |t, c| r << "#{t}: proc=#{(c.proc.class rescue 'n/a')} tooltip=#{(c.tooltip rescue nil).inspect} status=#{(c.status_bar_text rescue nil).inspect}" }
rescue => e
  r << "ERROR #{e.class}: #{e.message}"
end
File.write('C:/work/maksar-ruslan/staltus/build/kb/e02_commands.txt', r.join("\n"))
