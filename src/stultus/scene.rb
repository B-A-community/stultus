# frozen_string_literal: true
#
# Снимок состояния сцены для модели.
#
# Компактный JSON: единицы, выделение, объекты верхнего уровня с габаритами
# в миллиметрах, слои, материалы, камера. Всё, что позволяет модели понять,
# с чем она работает, не запрашивая геометрию целиком. Глубже — через
# execute_ruby.
#
# Выделение описывается подробнее остального: это то, о чём пользователь
# говорит «это». Для граней — площадь, нормаль и хозяин; для экземпляров
# компонентов — сколько всего экземпляров у определения.
#
# Размер ограничен SCENE_OBJECT_LIMIT: рабочие файлы бывают на тысячи
# групп, и слать их все в каждом сообщении — платить токенами впустую.
# Обрезка не скрывается: в ответе стоит truncated и общее число.

module BACommunity
  module Stultus
    module Scene
      UNIT_NAMES = { 0 => 'inch', 1 => 'feet', 2 => 'mm', 3 => 'cm', 4 => 'm', 5 => 'yard' }.freeze
      MM2_PER_IN2 = 645.16

      module_function

      def model
        Sketchup.active_model
      end

      # full: false — только то, что нужно всегда (единицы, контекст,
      # выделение); объекты, слои, материалы, камера — при full: true.
      def snapshot(full: true, limit: SCENE_OBJECT_LIMIT)
        m = model
        sel = m.selection.to_a
        snap = {
          title:   m.title.to_s.empty? ? 'Untitled' : m.title,
          path:    m.path.to_s.empty? ? nil : m.path,
          units:   units,
          # Внутри группы/компонента (режим редактирования) — говорим модели,
          # где она находится: entities отличаются от корня модели.
          context: m.active_path ? m.active_path.map { |e| describe_short(e) } : nil,
          selection_summary: Selection.summary,
          selection: sel.first(limit).map { |e| describe(e, detailed: true) },
          # Какие рендереры есть в этом SketchUp — модели, чтобы знать про render_vray.
          renderers: Dialog.renderers,
          plugin:  VERSION
        }
        return snap unless full

        entities = m.active_entities
        objects = entities.grep(Sketchup::Group) + entities.grep(Sketchup::ComponentInstance)
        snap.merge(
          counts:        counts(entities),
          objects:       objects.first(limit).map { |e| describe(e) },
          objects_total: objects.length,
          truncated:     objects.length > limit,
          layers:        m.layers.map(&:name).first(100),
          materials:     m.materials.map(&:name).first(100),
          camera:        camera
        )
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

      def describe(e, detailed: false)
        h = describe_short(e)
        h[:layer] = e.layer.name if e.respond_to?(:layer) && e.layer
        h[:material] = e.material.name if e.respond_to?(:material) && e.material
        h[:hidden] = true if e.respond_to?(:hidden?) && e.hidden?

        case e
        when Sketchup::ComponentInstance
          h[:definition] = e.definition.name
          h[:instances_total] = e.definition.count_instances
          h[:bounds_mm] = bounds_mm(e.bounds)
        when Sketchup::Group
          h[:bounds_mm] = bounds_mm(e.bounds)
        when Sketchup::Face
          h[:area_mm2] = (e.area * MM2_PER_IN2).round
          h[:normal] = e.normal.to_a.map { |v| v.round(3) }
          h[:vertices] = e.vertices.length
          h[:bounds_mm] = bounds_mm(e.bounds)
          h[:back_material] = e.back_material.name if e.back_material
        when Sketchup::Edge
          h[:length_mm] = mm(e.length)
          h[:start_mm] = pt_mm(e.start.position)
          h[:end_mm] = pt_mm(e.end.position)
        else
          h[:bounds_mm] = bounds_mm(e.bounds) if e.respond_to?(:bounds)
        end

        h[:owner] = owner_of(e) if detailed
        h
      end

      # Кому принадлежит сущность: корню модели или группе/компоненту.
      def owner_of(e)
        parent = e.parent
        return 'model' unless parent.is_a?(Sketchup::ComponentDefinition)
        if parent.group?
          inst = parent.instances.first
          { type: 'Group', id: inst&.entityID, name: inst && name_of(inst) }
        else
          { type: 'ComponentDefinition', name: parent.name, instances: parent.count_instances }
        end
      end

      def bounds_mm(b)
        return nil unless b && b.valid?
        # Размер считаем из углов: у BoundingBox height — это Y, а depth — Z,
        # и [width, depth, height] давал бы [X, Z, Y].
        {
          min:  pt_mm(b.min),
          max:  pt_mm(b.max),
          size: [mm(b.max.x - b.min.x), mm(b.max.y - b.min.y), mm(b.max.z - b.min.z)]
        }
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
          eye:         pt_mm(cam.eye),
          target:      pt_mm(cam.target),
          perspective: cam.perspective?
        }
      end

      # Поиск сущности по entityID: сначала текущий контекст, потом корень,
      # потом содержимое всех определений.
      def find_by_id(id)
        m = model
        [m.active_entities, m.entities].each do |ents|
          e = ents.find { |x| x.entityID == id }
          return e if e
        end
        m.definitions.each do |d|
          e = d.entities.find { |x| x.entityID == id }
          return e if e
        end
        nil
      end

      def pt_mm(p)
        [mm(p.x), mm(p.y), mm(p.z)]
      end

      def mm(inches)
        (inches.to_f * 25.4).round(1)
      end
    end
  end
end
