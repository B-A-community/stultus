# frozen_string_literal: true
#
# Массинг окружения по карте.
#
# Сервер уже нашёл здания и пересчитал их контуры в метры относительно
# точки запроса (X на восток, Y на север). Здесь только геометрия: группа
# «Массинг» на своём слое, внутри — группа на здание: грань по контуру
# (с дырами, если есть внутренние дворы), выдавленная на высоту. Здание с
# оценённой высотой получает свой материал, чтобы условность была видна
# в модели, а не только в тексте ответа.
#
# Весь вызов — одна операция Undo (или прозрачная, если ход уже открыт).

module BACommunity
  module Stultus
    module Massing
      LAYER_NAME     = 'Stultus · Массинг'
      MATERIALS = {
        'known'    => ['Stultus массинг',          [205, 205, 200]],
        'estimate' => ['Stultus массинг · высота без данных', [214, 196, 160]],
        'target'   => ['Stultus массинг · объект', [232, 160, 70]]
      }.freeze

      module_function

      def build(massing, transparent: false)
        buildings = Array(massing['buildings'])
        return { ok: false, error: 'Список зданий пуст.' } if buildings.empty?

        model = Sketchup.active_model
        place = massing['place'] || {}
        label = place['label'].to_s.strip
        label = 'по карте' if label.empty?
        model.start_operation("#{PLUGIN_NAME}: массинг #{label[0, 50]}", true, false, transparent)
        started = Time.now
        begin
          layer = model.layers[LAYER_NAME] || model.layers.add(LAYER_NAME)
          materials = MATERIALS.transform_values { |(name, rgb)| material(model, name, rgb) }
          top = model.active_entities.add_group
          top.name = "Массинг: #{label[0, 80]} · #{massing['radius']} м"
          top.layer = layer
          top.set_attribute('stultus_massing', 'place', label)
          top.set_attribute('stultus_massing', 'lat', place['lat'].to_f)
          top.set_attribute('stultus_massing', 'lon', place['lon'].to_f)
          top.set_attribute('stultus_massing', 'radius', massing['radius'].to_i)
          top.set_attribute('stultus_massing', 'sources', Array(massing['sources']).join(', '))

          built = 0
          failed = []
          buildings.each do |b|
            begin
              add_building(top.entities, b, layer, materials)
              built += 1
            rescue StandardError => e
              failed << "#{b['id']}: #{e.message[0, 80]}"
            end
          end
          raise 'Ни одно здание не построилось' if built.zero?

          geolocate(model, place)
          model.commit_operation
          model.selection.clear
          model.selection.add(top)
          model.active_view.zoom(top)
          model.active_view.invalidate
          {
            ok:       true,
            built:    built,
            failed:   failed.length,
            group_id: top.entityID,
            seconds:  (Time.now - started).round(2),
            text:     "Массинг построен: #{built} зданий в группе «#{top.name}» (id #{top.entityID}, слой «#{LAYER_NAME}»), " \
                      "начало координат модели — точка запроса, земля Z=0. Материалы: серый — высота по данным, " \
                      "бежевый — высота без данных (подобрана по соседям или оценена по типу, см. имя группы), " \
                      "оранжевый — запрошенный адрес." \
                      "#{failed.empty? ? '' : " Не построились #{failed.length}: #{failed.first(5).join('; ')}."}"
          }
        rescue StandardError => e
          model.abort_operation
          { ok: false, error: "#{e.class}: #{e.message}", backtrace: Array(e.backtrace).first(3) }
        end
      end

      def add_building(entities, b, layer, materials)
        outer = points(b['outer'], b['minHeight'])
        raise 'меньше трёх точек' if outer.length < 3

        g = entities.add_group
        g.layer = layer
        title = b['name'].to_s.strip
        title = b['address'].to_s.strip if title.empty?
        title = b['type'].to_s if title.empty?
        levels = b['levels'] ? "#{b['levels']} эт. · " : ''
        mark = case b['heightSource']
               when 'estimate'   then ' (оценка по типу)'
               when 'neighbours' then ' (по соседям)'
               else ''
               end
        g.name = "#{title[0, 60]} · #{levels}#{b['height']} м#{mark}"
        %w[id type name address levels height minHeight heightSource area distance].each do |k|
          g.set_attribute('stultus_massing', k, b[k]) unless b[k].nil?
        end

        face = g.entities.add_face(outer)
        Array(b['inners']).each do |ring|
          hole = points(ring, b['minHeight'])
          next if hole.length < 3
          begin
            inner = g.entities.add_face(hole)
            inner.erase! if inner && inner.valid?
          rescue StandardError
            next
          end
        end
        face = g.entities.grep(Sketchup::Face).max_by(&:area) if face.nil? || face.deleted?
        raise 'грань не создалась' unless face

        height = b['height'].to_f - b['minHeight'].to_f
        height = 3.0 if height <= 0
        face.reverse! if face.normal.z < 0
        face.pushpull(height.m)
        key = if b['target'] then 'target'
              elsif %w[estimate neighbours].include?(b['heightSource']) then 'estimate'
              else 'known'
              end
        g.material = materials[key]
        g.entities.grep(Sketchup::Face).each { |f| f.material = materials[key] }
        g
      end

      def points(ring, z)
        zz = z.to_f
        Array(ring).map { |xy| Geom::Point3d.new(xy[0].to_f.m, xy[1].to_f.m, zz.m) }
      end

      def material(model, name, rgb)
        m = model.materials[name]
        return m if m
        m = model.materials.add(name)
        m.color = Sketchup::Color.new(*rgb)
        m
      end

      # Геопривязка модели точкой запроса: тени и солнце становятся честными.
      # Уже привязанную модель не трогаем.
      def geolocate(model, place)
        return if model.georeferenced?
        lat = place['lat'].to_f
        lon = place['lon'].to_f
        return if lat.zero? && lon.zero?
        si = model.shadow_info
        si['Latitude'] = lat
        si['Longitude'] = lon
      rescue StandardError
        nil
      end
    end
  end
end
