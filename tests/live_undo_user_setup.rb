# Подготовка живой проверки отмены: «пользователь» строит дом и стирает его
# обычными операциями, как если бы делал это руками. Дом — далеко в стороне.
m = Sketchup.active_model
m.start_operation('Дом пользователя', true)
g = m.active_entities.add_group
g.name = 'ТЕСТ Stultus дом пользователя'
f = g.entities.add_face([990.m, 1000.m, 0], [995.m, 1000.m, 0], [995.m, 1005.m, 0], [990.m, 1005.m, 0])
f.reverse! if f.normal.z < 0
f.pushpull(6.m)
m.commit_operation
m.start_operation('Стереть', true)
m.entities.grep(Sketchup::Group).select { |x| x.name == 'ТЕСТ Stultus дом пользователя' }.each(&:erase!)
m.commit_operation
m.entities.grep(Sketchup::Group).map(&:name).select { |n| n.to_s.start_with?('ТЕСТ Stultus') }.inspect
