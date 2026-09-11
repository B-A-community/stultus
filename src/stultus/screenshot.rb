# frozen_string_literal: true
#
# Снимок вьюпорта для модели.
#
# Снимается только после согласия пользователя — кнопка в окне чата. Модель
# может попросить стандартный вид (iso/top/front/right/back/left) и
# «показать всё»: тогда камера переставляется ПЕРЕД снимком, а после —
# возвращается на место, чтобы не сбивать человеку его ракурс.
#
# Оверлеи инструментов в write_image не попадают — снимается только модель.

require 'base64'

module BACommunity
  module Stultus
    module Screenshot
      VIEWS = {
        'iso'   => 'viewIso:',
        'top'   => 'viewTop:',
        'front' => 'viewFront:',
        'right' => 'viewRight:',
        'back'  => 'viewBack:',
        'left'  => 'viewLeft:'
      }.freeze

      module_function

      # Возвращает { ok:, mime:, base64:, width:, height: } или { ok: false, error: }.
      def take(view_name: nil, zoom_extents: false, width: 1280, height: 800)
        model = Sketchup.active_model
        view  = model.active_view
        saved = snapshot_camera(view)

        if VIEWS.key?(view_name.to_s)
          Sketchup.send_action(VIEWS[view_name.to_s])
        end
        view.zoom_extents if zoom_extents
        # send_action и zoom применяются на следующей итерации цикла событий;
        # даём им пройти, иначе снимок будет со старой камеры.
        view.invalidate
        wait_a_tick

        path = File.join(temp_dir, "stultus_#{Process.pid}_#{Time.now.to_i}.png")
        ok = begin
          view.write_image({ filename: path, width: width.to_i, height: height.to_i,
                             antialias: true, compression: 0.9, transparent: false })
        rescue ArgumentError, TypeError
          view.write_image(path, width.to_i, height.to_i, true, 0.9)
        end
        raise "write_image не создал файл (вернул #{ok.inspect})" unless File.exist?(path)

        data = File.binread(path)
        File.delete(path) rescue nil
        { ok: true, mime: 'image/png', base64: Base64.strict_encode64(data),
          width: width.to_i, height: height.to_i, bytes: data.bytesize }
      rescue StandardError => e
        { ok: false, error: "#{e.class}: #{e.message}" }
      ensure
        restore_camera(view, saved) if saved && (VIEWS.key?(view_name.to_s) || zoom_extents)
      end

      def snapshot_camera(view)
        cam = view.camera
        { eye: cam.eye, target: cam.target, up: cam.up, perspective: cam.perspective?, fov: (cam.perspective? ? cam.fov : nil) }
      rescue StandardError
        nil
      end

      def restore_camera(view, saved)
        cam = view.camera
        cam.perspective = saved[:perspective]
        cam.set(saved[:eye], saved[:target], saved[:up])
        cam.fov = saved[:fov] if saved[:fov]
        view.invalidate
      rescue StandardError
        nil
      end

      # Прокрутить цикл событий, не выходя из вызова: у SketchUp нет
      # публичного «process events», но короткий sleep на главном потоке
      # даёт отрисовке пройти на Windows.
      def wait_a_tick
        sleep 0.15
      end

      def temp_dir
        ENV['TEMP'] || ENV['TMP'] || Dir.tmpdir
      end
    end
  end
end
