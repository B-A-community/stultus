# Проверка исправления отмены (0.2.27): тот же сценарий «дом → велосипед»,
# что в live_undo_bug.rb, но через новый путь окна — каждый шаг модели
# своим пунктом Undo в журнале UndoLedger, отмена через undo_step.
# Плюс коварные случаи: упавший скрипт, шаг только на чтение, запись
# переписки между шагами, действие пользователя посреди хода, кнопка
# «Отменить ход».
# Объекты теста — «ТЕСТ Stultus …» в километре от начала, в конце удаляются.
module StultusUndoFix
  S = BACommunity::Stultus
  OUT = 'C:/work/maksar-ruslan/staltus/build/undo_fix.txt'

  module_function

  def box_code(name, x)
    "g = Sketchup.active_model.active_entities.add_group; g.name = '#{name}'; " \
      "f = g.entities.add_face([#{x}.m,1000.m,0], [#{x + 2}.m,1000.m,0], [#{x + 2}.m,1002.m,0], [#{x}.m,1002.m,0]); " \
      "f.reverse! if f.normal.z < 0; f.pushpull(2.m); g.name"
  end

  # Шаг модели ровно так, как его делает окно (dialog.rb, execute_ruby).
  def step(turn, label, code)
    S::UndoLedger.track(turn, label) { S::Runner.execute(code, label: label) }
  end

  def names
    Sketchup.active_model.entities.grep(Sketchup::Group).map(&:name).select { |n| n.to_s.start_with?('ТЕСТ Stultus') }.sort
  end

  def run
    m = Sketchup.active_model
    log = []
    note = ->(what) { log << "#{what}: #{names.empty? ? 'пусто' : names.join(', ')}" }
    say = ->(what, r) { log << "   #{what} → #{r[:ok] ? 'ok' : 'ОТКАЗ'}: #{r[:text] || r[:error]}" }

    # Прошлый ход: модель построила дом.
    step('t1', 'дом · коробка', box_code('ТЕСТ Stultus дом', 0))
    note.call('1. дом построен (прошлый ход)')
    # Пользователь сам стёр дом.
    m.start_operation('Стереть', true)
    m.entities.grep(Sketchup::Group).select { |g| g.name == 'ТЕСТ Stultus дом' }.each(&:erase!)
    m.commit_operation
    note.call('2. пользователь стёр дом')

    # Ход «велосипед».
    step('t2', 'велосипед · колесо 1', box_code('ТЕСТ Stultus колесо 1', 10))
    S::History.write('stultus_test_note', 'переписка между шагами') # служебная запись окна
    step('t2', 'велосипед · проверка', 'Sketchup.active_model.entities.length') # только чтение
    step('t2', 'велосипед · колесо 2', box_code('ТЕСТ Stultus колесо 2', 14))
    r = step('t2', 'велосипед · опечатка', "raise 'ошибка в скрипте'") # упавший шаг — откат
    log << "   упавший шаг → #{r[:ok] ? 'ok' : 'ошибка, откачен'}"
    step('t2', 'велосипед · рама кривая', box_code('ТЕСТ Stultus рама кривая', 18))
    note.call("3. колёса и кривая рама (шагов хода сверху: #{S::UndoLedger.steps_on_top('t2')})")

    say.call('4. модель: undo', S::UndoLedger.undo_step('t2'))
    note.call('   после отмены')
    step('t2', 'велосипед · рама 2', box_code('ТЕСТ Stultus рама 2', 22))
    note.call('5. новая рама')
    say.call('6. модель: undo', S::UndoLedger.undo_step('t2'))
    note.call('   после отмены')
    say.call('7. модель: undo', S::UndoLedger.undo_step('t2'))
    note.call('   после отмены')
    say.call('8. модель: undo', S::UndoLedger.undo_step('t2'))
    note.call('   после отмены')
    say.call('9. модель: undo ещё раз (своих шагов больше нет)', S::UndoLedger.undo_step('t2'))
    note.call('   дом не вернулся?')

    # Пользователь вмешался посреди хода: модель не должна снимать его действие.
    step('t3', 'стол · столешница', box_code('ТЕСТ Stultus столешница', 30))
    m.start_operation('Пользователь: свой ящик', true)
    eval(box_code('ТЕСТ Stultus ящик пользователя', 34)) # настоящий ящик: пустую группу SketchUp удаляет сам
    m.commit_operation
    say.call('10. модель: undo после действия пользователя', S::UndoLedger.undo_step('t3'))
    note.call('   ящик пользователя на месте?')
    say.call('11. кнопка «Отменить ход» после действия пользователя', S::UndoLedger.undo_turn('t3'))

    # Кнопка «Отменить ход» на чистом ходе.
    step('t4', 'лавка · сиденье', box_code('ТЕСТ Stultus сиденье', 40))
    step('t4', 'лавка · ножки', box_code('ТЕСТ Stultus ножки', 44))
    note.call("12. лавка из двух шагов (сверху: #{S::UndoLedger.steps_on_top('t4')})")
    say.call('13. кнопка «Отменить ход»', S::UndoLedger.undo_turn('t4'))
    note.call('   после кнопки')
  ensure
    m.start_operation('Уборка теста Stultus', true)
    begin
      m.entities.grep(Sketchup::Group).select { |g| g.name.to_s.start_with?('ТЕСТ Stultus') }.each(&:erase!)
      dict = m.attribute_dictionary(S::DICTIONARY, false)
      dict.delete_key('stultus_test_note') if dict
    ensure
      # Операция закрывается всегда: открытая операция в SketchUp пользователя недопустима.
      m.commit_operation
    end
    log << "уборка: #{names.empty? ? 'тестовых объектов не осталось' : names.join(', ')}"
    File.write(OUT, log.join("\n"))
  end
end
StultusUndoFix.run
true
