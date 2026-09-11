# frozen_string_literal: true
#
# Снимок состояния сцены для модели.
#
# Компактный JSON: единицы, выделение, объекты верхнего уровня с габаритами
# в миллиметрах, слои, материалы, камера. Всё, что позволяет модели понять,
# с чем она работает, не запрашивая геометрию целиком. Глубже — через
# execute_ruby.
#
# Размер ограничен SCENE_OBJECT_LIMIT: рабочие файлы бывают на тысячи
# групп, и слать их все в каждом сообщении — платить токенами впустую.
# Обрезка не скрывается: в ответе стоит truncated и общее число.

module BACommunity
  module Stultus
    module Scene
      UNIT_NAMES = { 0 => 'inch', 1 => 'feet', 2 => 'mm', 3 => 'cm', 4 => 'm', 5 => 'yard' }.freeze

      module_function

      def model
        Sketchup.active_model
      end

      def snapshot(limit: SCENE_OBJECT_LIMIT)
        m = model
        entities = m.active_entities
        objects = entities.grep(Sketchup::Group) + entities.grep(Sketchup::ComponentInstance)

        {
          title:      m.title.to_s.empty? ? 'Untitled' : m.title,
          path:       m.path.to_s.empty? ? nil : m.path,
          units:      units,
          # Внутри группы/компонента (режим редактирования) — говорим модели,
          # где она находится: entities отличаются от корня модели.
          context:    m.active_path ? m.active_path.map { |e| describe_short(e) } : nil,
          counts:     counts(entities),
          selection:  m.selection.map { |e| describe(e) }.first(limit),
          objects:    objects.first(limit).map { |e| describe(e) },
          objects_total: objects.length,
          truncated:  objects.length > limit,
          layers:     m.layers.map(&:name).first(100),
          materials:  m.materials.map(&:name).first(100),
          camera:     camera,
          plugin:     VERSION
        }
      end

      def units
        opts = model.options['UnitsOptions']
        { length: UNIT_NAMES[opts['LengthUnit']] || opts['LengthUnit'].to_s, api: 'inch' }
      end

      def counts(entities)
        c = Hash.new(0)
        entities.each { |e| c[e.class.name.split('::').last] += 1 }
        c
      end

      def describe_short(e)
        { id: e.entityID, type: type_of(e), name: name_of(e) }
      end

      def describe(e)
        h = describe_short(e)
        h[:definition] = e.definition.name if e.respond_to?(:definition) && e.definition
        h[:layer] = e.layer.name if e.respond_to?(:layer) && e.layer
        if e.respond_to?(:material) && e.material
          h[:material] = e.material.name
        end
        if e.respond_to?(:bounds)
          b = e.bounds
          if b.valid?
            h[:bounds_mm] = {
              min:  [mm(b.min.x), mm(b.min.y), mm(b.min.z)],
              max:  [mm(b.max.x), mm(b.max.y), mm(b.max.z)],
              size: [mm(b.width), mm(b.depth), mm(b.height)]
            }
          end
        end
        h[:hidden] = true if e.respond_to?(:hidden?) && e.hidden?
        h
      end

      def type_of(e)
        e.class.name.split('::').last
      end

      def name_of(e)
        return e.name if e.respond_to?(:name) && e.name.is_a?(String) && !e.name.empty?
        return e.definition.name if e.respond_to?(:definition) && e.definition
        nil
      end

      def camera
        cam = model.active_view.camera
        {
          eye:         [mm(cam.eye.x), mm(cam.eye.y), mm(cam.eye.z)],
          target:      [mm(cam.target.x), mm(cam.target.y), mm(cam.target.z)],
          perspective: cam.perspective?
        }
      end

      def mm(inches)
        (inches.to_f * 25.4).round(1)
      end
    end
  end
end
