# frozen_string_literal: true
#
# Визуализация обратно в модель — сценой.
#
# Готовый кадр кладётся в модель как Image-сущность на плоскости перед
# камерой снимка: плоскость перпендикулярна взгляду, размер подобран под
# угол обзора, поэтому в созданной сцене картинка ложится точно на кадр.
# Картинка живёт на своём теге «Stultus · визуализации», который включён
# только в этой сцене и выключен в остальных, чтобы не мешать работе.
# Всё — одна операция Undo.

require 'json'

module BACommunity
  module Stultus
    module Overlay
      TAG = 'Stultus · визуализации'

      module_function

      # id — кадр из RenderAssets; name — имя сцены (пусто → «Визуализация N»).
      def place_scene(id, name: nil)
        model = Sketchup.active_model
        meta = RenderAssets.meta(id)
        return { ok: false, error: 'У этого кадра нет данных о камере: он сделан старой версией плагина.' } unless meta && meta['camera']
        path = RenderAssets.display_path(id)
        return { ok: false, error: 'Файл кадра не найден на этом компьютере.' } unless path && File.file?(path)

        cam = meta['camera']
        eye = Geom::Point3d.new(*cam['eye'])
        target = Geom::Point3d.new(*cam['target'])
        up = Geom::Vector3d.new(*cam['up'])
        dir = eye.vector_to(target)
        return { ok: false, error: 'Камера снимка вырождена.' } if dir.length.zero?
        dir.normalize!
        right = dir.cross(up)
        return { ok: false, error: 'Камера снимка вырождена (up параллелен взгляду).' } if right.length.zero?
        right.normalize!
        upv = right.cross(dir).normalize

        aspect = (meta['width'].to_f / meta['height'].to_f)
        aspect = (cam['aspect_ratio'].to_f.positive? ? cam['aspect_ratio'].to_f : 16.0 / 9) unless aspect.finite? && aspect.positive?
        # Плоскость — на половине пути до цели, но не ближе 500 мм: ближе
        # SketchUp начинает резать ближней плоскостью.
        distance = [eye.distance(target) * 0.5, 500.mm].max
        if cam['perspective'] == false
          height = cam['height'].to_f.positive? ? cam['height'].to_f : 10_000.mm
        else
          fov = cam['fov'].to_f.positive? ? cam['fov'].to_f : 35.0
          span = 2.0 * distance * Math.tan(fov * Math::PI / 360.0)
          # fov — вертикальный угол (fov_is_height) либо горизонтальный.
          height = cam['fov_is_height'] == false ? span / aspect : span
        end
        width = height * aspect

        name = name.to_s.strip
        name = next_name(model) if name.empty?
        model.start_operation("Stultus: сцена «#{name}»", true)
        begin
          layer = model.layers[TAG] || model.layers.add(TAG)
          image = model.active_entities.add_image(path, ORIGIN, width, height)
          raise 'SketchUp не создал изображение' unless image
          image.layer = layer
          center = eye.offset(dir, distance)
          origin = center.offset(right, -width / 2.0).offset(upv, -height / 2.0)
          image.transform!(Geom::Transformation.axes(origin, right, upv, right.cross(upv)))

          camera = Sketchup::Camera.new(eye, target, up, cam['perspective'] != false)
          if cam['perspective'] == false
            camera.height = height if camera.respond_to?(:height=)
          elsif cam['fov'].to_f.positive?
            camera.fov = cam['fov'].to_f
          end
          camera.aspect_ratio = 0.0 if camera.respond_to?(:aspect_ratio=)
          model.active_view.camera = camera

          # Тег виден только в новой сцене: остальные сцены запоминают «выключен».
          model.pages.each { |p| p.set_visibility(layer, false) if p.use_hidden_layers? }
          layer.visible = true
          page = model.pages.add(name)
          page.use_camera = true
          page.use_hidden_layers = true
          page.set_visibility(layer, true)
          model.commit_operation
        rescue StandardError => e
          model.abort_operation
          return { ok: false, error: "#{e.class}: #{e.message}" }
        end
        { ok: true, scene: name, tag: TAG, width_mm: width.to_mm.round, height_mm: height.to_mm.round }
      end

      def next_name(model)
        taken = model.pages.map(&:name)
        n = 1
        n += 1 while taken.include?("Визуализация #{n}")
        "Визуализация #{n}"
      end
    end
  end
end
