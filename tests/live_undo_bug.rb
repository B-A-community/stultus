# Воспроизведение бага с отменой (как окно плагина вело себя до 0.2.27).
#
# Сценарий пользователя: был дом, пользователь его удалил, попросил
# велосипед. Модель строит колёса, раму, ошибается и зовёт undo.
# Окно тогда передавало первый шаг хода обычной операцией, а остальные
# прозрачными (сливались в пункт хода), undo просто звал Sketchup.undo.
#
# Все объекты теста — группы «ТЕСТ Stultus …» в километре от начала
# координат; в конце они удаляются. Чужие объекты модели тест не трогает.
module StultusUndoBug
  R = BACommunity::Stultus::Runner
  OUT = 'C:/work/maksar-ruslan/staltus/build/undo_bug.txt'

  module_function

  def box_code(name, x)
    "g = Sketchup.active_model.active_entities.add_group; g.name = '#{name}'; " \
      "f = g.entities.add_face([#{x}.m,1000.m,0], [#{x + 2}.m,1000.m,0], [#{x + 2}.m,1002.m,0], [#{x}.m,1002.m,0]); " \
      "f.reverse! if f.normal.z < 0; f.pushpull(2.m); g.name"
  end

  def names
    Sketchup.active_model.entities.grep(Sketchup::Group).map(&:name).select { |n| n.start_with?('ТЕСТ Stultus') }.sort
  end

  def run
    m = Sketchup.active_model
    log = []
    note = ->(what) { log << "#{what}: #{names.empty? ? 'пусто' : names.join(', ')}" }

    # 1. Когда-то раньше модель построила дом (прошлый ход).
    R.execute(box_code('ТЕСТ Stultus дом', 0), label: 'Ход: дом')
    note.call('1. дом построен')
    # 2. Пользователь сам удалил дом, чтобы начать велосипед.
    m.start_operation('Стереть', true)
    m.entities.grep(Sketchup::Group).select { |g| g.name == 'ТЕСТ Stultus дом' }.each(&:erase!)
    m.commit_operation
    note.call('2. пользователь стёр дом')
    # 3. Ход «велосипед»: первый шаг открывает пункт, остальные прозрачные.
    R.execute(box_code('ТЕСТ Stultus колесо 1', 10), label: 'Ход: велосипед', transparent: false)
    R.execute(box_code('ТЕСТ Stultus колесо 2', 14), label: 'колесо 2', transparent: true)
    R.execute(box_code('ТЕСТ Stultus рама кривая', 18), label: 'рама', transparent: true)
    note.call('3. колёса и кривая рама')
    # 4. Модели не понравилась рама — undo.
    Sketchup.undo
    note.call('4. модель нажала undo один раз')
    # 5. Модель строит раму заново; окно считает, что пункт хода уже открыт.
    R.execute(box_code('ТЕСТ Stultus рама 2', 22), label: 'рама заново', transparent: true)
    note.call('5. новая рама')
    # 6. Снова не понравилось — undo.
    Sketchup.undo
    note.call('6. модель нажала undo второй раз')
  ensure
    # Уборка: всё тестовое удаляем одной операцией.
    m.start_operation('Уборка теста Stultus', true)
    m.entities.grep(Sketchup::Group).select { |g| g.name.to_s.start_with?('ТЕСТ Stultus') }.each(&:erase!)
    m.commit_operation
    log << "уборка: #{names.empty? ? 'тестовых объектов не осталось' : names.join(', ')}"
    File.write(OUT, log.join("\n"))
  end
end
StultusUndoBug.run
File.read(StultusUndoBug::OUT)
