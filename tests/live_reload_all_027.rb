# Полная перезагрузка плагина из папки Plugins без перезапуска SketchUp:
# все модули по порядку main.rb, старый Runner.undo снимается, окно
# открывается заново. Тестовые остатки «ТЕСТ Stultus …» убираются.
S = BACommunity::Stultus
base = S::PLUGIN_PATH
%w[constants undo_ledger settings history scene selection runner screenshot render_assets vray scenes attachments massing dialog].each do |f|
  load File.join(base, "#{f}.rb")
end
S::Runner.singleton_class.send(:remove_method, :undo) rescue nil
m = Sketchup.active_model
left = m.entities.grep(Sketchup::Group).select { |g| g.name.to_s.start_with?('ТЕСТ Stultus') }
unless left.empty?
  m.start_operation('Уборка теста Stultus', true)
  begin
    left.each(&:erase!)
  ensure
    m.commit_operation
  end
end
S::UndoLedger.reset
d = S::Dialog.instance_variable_get(:@dialog)
d.close if d
S.open
[S::VERSION, base, left.length, S::Runner.respond_to?(:undo)].inspect
