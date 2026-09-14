# frozen_string_literal: true
#
# V-Ray for SketchUp: рендер текущего вида через официальный Ruby API.
#
# Только задокументированные вызовы (документация лежит в дистрибутиве:
# extension/documentation/index.html). Всё проверено на живом SketchUp 2024
# с V-Ray 6.20, см. docs/KNOWLEDGE-VRAY.md. Что ронял SketchUp: чтение
# параметра плагина строкой (`plugin['img_width']`) — ключ только Symbol.
#
# Цикл: запомнить настройки → выставить размер и качество внутри
# scene.change → подписаться на on_state_changed → Command.render_production
# → по :idleDone сохранить renderer.image → вернуть настройки → отписаться.
# Рендер идёт в фоне, SketchUp не блокируется; ответ уходит колбэком.

require 'base64'
require 'fileutils'

module BACommunity
  module Stultus
    module VRayRender
      # Пресеты качества — параметры прогрессивного сэмплера (type = 3).
      PRESETS = {
        'draft'  => { progressive_maxSubdivs: 6,  progressive_threshold: 0.1 },
        'medium' => { progressive_maxSubdivs: 20, progressive_threshold: 0.04 },
        'high'   => { progressive_maxSubdivs: 40, progressive_threshold: 0.01 }
      }.freeze
      FINAL_STATES = %i[idleDone idleStopped idleError fatalError].freeze

      module_function

      def available?
        defined?(::VRay::Context) && defined?(::VRay::Command) ? true : false
      end

      def version
        ext = Sketchup.extensions.find { |e| e.name =~ /V-Ray/i }
        ext && ext.version.to_s.strip
      end

      def state
        return nil unless available?
        ctx = ::VRay::Context.active(false)
        ctx && ctx.renderer.state
      end

      # Асинхронный рендер. done.call(hash) вызывается на главном потоке.
      # width/height — пиксели; preset — draft|medium|high; timeout — секунды;
      # save_to — файл .png или папка (имя подставится), куда дополнительно
      # сохранить кадр; папка создаётся.
      def render(width: 1280, height: 720, preset: 'medium', timeout: 600, save_to: nil, &done)
        return done.call(ok: false, error: 'V-Ray не установлен или не загружен.') unless available?
        ctx = ::VRay::Context.active
        scene = ctx.scene
        rd = ctx.renderer
        unless %i[idleDone idleInitialized idleStopped idleError].include?(rd.state)
          return done.call(ok: false, error: "V-Ray занят: состояние #{rd.state}. Остановите текущий рендер.")
        end

        out = scene['/SettingsOutput']
        sampler = scene['/SettingsImageSampler']
        saved = { width: out[:img_width], height: out[:img_height] }
        params = PRESETS[preset.to_s] || PRESETS['medium']
        saved_sampler = params.keys.to_h { |k| [k, sampler[k]] }

        scene.change do
          out[:img_width] = width.to_i.clamp(64, 8192)
          out[:img_height] = height.to_i.clamp(64, 8192)
          params.each { |k, v| sampler[k] = v }
        end

        started = Time.now
        finished = false
        sub = Subscriber.new do |new_state|
          next if finished || !FINAL_STATES.include?(new_state)
          finished = true
          # Сохраняем не из колбэка рендерера, а следующим тиком главного потока.
          UI.start_timer(0.3, false) do
            result = collect(rd, new_state, started)
            result = save_copy(result, save_to) if result[:ok] && save_to && !save_to.to_s.strip.empty?
            restore(scene, out, sampler, saved, saved_sampler)
            rd.unsubscribe(sub) rescue nil
            done.call(result)
          end
        end
        rd.subscribe(sub)

        # Страховка по времени: остановить и отдать то, что есть.
        UI.start_timer(timeout.to_f, false) do
          next if finished
          ::VRay::Command.stop_current_render(context: ctx) rescue nil
        end

        ::VRay::Command.render_production(context: ctx)
        nil
      rescue StandardError => e
        restore(scene, out, sampler, saved, saved_sampler) if scene && out && saved
        done.call(ok: false, error: "#{e.class}: #{e.message}")
      end

      def collect(rd, final_state, started)
        img = rd.image(do_color_correct: true, strip_alpha: true)
        path = File.join(ENV['TEMP'] || Dir.tmpdir, "stultus_vray_#{Process.pid}_#{Time.now.to_i}.png")
        ok = img.save(path, format: :png)
        raise "V-Ray не сохранил изображение (#{final_state})" unless ok && File.exist?(path)
        data = File.binread(path)
        File.delete(path) rescue nil
        {
          ok: true, mime: 'image/png', base64: Base64.strict_encode64(data),
          width: img.width, height: img.height, bytes: data.bytesize,
          state: final_state, seconds: (Time.now - started).round(1)
        }
      rescue StandardError => e
        { ok: false, error: "#{e.class}: #{e.message}", state: final_state }
      end

      # Сохранить кадр по пути пользователя. Файл — только с расширением
      # (.png/.jpg); всё остальное (существующая папка, слеш на конце, путь без
      # расширения) — папка, которая создаётся, с файлом stultus_vray_<дата>.png.
      # «В папку …» говорят куда чаще, чем имя файла без расширения.
      def save_copy(result, save_to)
        raw = save_to.to_s.strip
        path = File.expand_path(raw.tr('\\', '/'))
        if File.directory?(path) || raw.end_with?('/', '\\') || File.extname(path).empty?
          FileUtils.mkdir_p(path)
          path = File.join(path, "stultus_vray_#{Time.now.strftime('%Y%m%d_%H%M%S')}.png")
        else
          FileUtils.mkdir_p(File.dirname(path))
          path = "#{path}.png" unless File.extname(path).casecmp('.png').zero?
        end
        File.binwrite(path, Base64.strict_decode64(result[:base64]))
        result.merge(saved_to: path)
      rescue StandardError => e
        result.merge(save_error: "#{e.class}: #{e.message}")
      end

      def restore(scene, out, sampler, saved, saved_sampler)
        scene.change do
          out[:img_width] = saved[:width]
          out[:img_height] = saved[:height]
          saved_sampler.each { |k, v| sampler[k] = v }
        end
      rescue StandardError
        nil
      end

      # Подписчик рендерера: из документированных событий нужен только
      # on_state_changed. Внутри колбэка ничего тяжёлого не делаем.
      class Subscriber
        def initialize(&on_state)
          @on_state = on_state
        end

        def on_state_changed(_renderer, _old_state, new_state, _instant)
          @on_state.call(new_state)
        rescue StandardError
          nil
        end
      end
    end
  end
end
