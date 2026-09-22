# Как SketchUp сообщает об операциях: какие события приходят наблюдателю
# модели на обычную, пустую и прозрачную операцию, на отмену и на откат.
# Нужно, чтобы вести учёт своих пунктов Undo без догадок.
# Объекты теста — «ТЕСТ Stultus …» в километре от начала, в конце удаляются.
module StultusUndoProbe
  OUT = 'C:/work/maksar-ruslan/staltus/build/undo_probe.txt'

  class Spy < Sketchup::ModelObserver
    attr_reader :events
    def initialize; @events = []; end
    %i[onTransactionStart onTransactionCommit onTransactionAbort onTransactionUndo onTransactionRedo onTransactionEmpty].each do |ev|
      define_method(ev) { |_model| @events << ev.to_s.sub('onTransaction', '') }
    end
  end

  module_function

  def box(m, name, x)
    g = m.active_entities.add_group
    g.name = name
    f = g.entities.add_face([x.m, 1000.m, 0], [(x + 2).m, 1000.m, 0], [(x + 2).m, 1002.m, 0], [x.m, 1002.m, 0])
    f.reverse! if f.normal.z < 0
    f.pushpull(2.m)
  end

  def names(m)
    m.entities.grep(Sketchup::Group).map(&:name).select { |n| n.to_s.start_with?('ТЕСТ Stultus') }.sort
  end

  def run
    m = Sketchup.active_model
    spy = Spy.new
    m.add_observer(spy)
    log = []
    step = lambda do |title|
      log << "#{title}: события=#{spy.events.join(',')} | объекты=#{names(m).join(', ')}"
      spy.events.clear
    end

    m.start_operation('Проба A', true); box(m, 'ТЕСТ Stultus A', 0); m.commit_operation
    step.call('обычная операция A')
    m.start_operation('Проба пустая', true); m.commit_operation
    step.call('пустая операция (без изменений)')
    Sketchup.undo
    step.call('undo после пустой')
    m.start_operation('Проба B', true); box(m, 'ТЕСТ Stultus B', 4); m.commit_operation
    m.start_operation('Проба C прозрачная', true, false, true); box(m, 'ТЕСТ Stultus C', 8); m.commit_operation
    step.call('B и прозрачная C')
    Sketchup.undo
    step.call('undo после B+C')
    m.start_operation('Проба D откат', true); box(m, 'ТЕСТ Stultus D', 12); m.abort_operation
    step.call('D с abort')
    m.start_operation('Проба E', true); m.set_attribute('stultus_probe', 'x', 1); m.commit_operation
    step.call('E: только атрибут модели')
    Sketchup.undo
    step.call('undo E')
  ensure
    m.remove_observer(spy) rescue nil
    m.start_operation('Уборка теста Stultus', true)
    m.entities.grep(Sketchup::Group).select { |g| g.name.to_s.start_with?('ТЕСТ Stultus') }.each(&:erase!)
    m.attribute_dictionaries&.delete('stultus_probe') rescue nil
    m.commit_operation
    log << "уборка: #{names(m).empty? ? 'чисто' : names(m).join(', ')}"
    File.write(OUT, log.join("\n"))
  end
end
StultusUndoProbe.run
true
