# frozen_string_literal: true
#
# Окно чата — UI::HtmlDialog.
#
# Разделение обязанностей:
#
#   * JS (html/app.js) — весь чат, соединение с gateway по WebSocket,
#     стриминг, карточки инструментов, вопрос про снимок. Сеть живёт в
#     браузере намеренно: Ruby в SketchUp однопоточный, и любое ожидание
#     ответа модели из Ruby подвесило бы приложение;
#   * Ruby (этот файл) — только инструменты над моделью: выполнить код,
#     отдать снимок сцены, снять вьюпорт, прочитать/записать переписку,
#     настройки.
#
# Протокол между ними: JS зовёт sketchup.<callback>(id, json), Ruby отвечает
# через execute_script('Stultus.receive({...})') с тем же id. Все ответы
# асинхронные — так JS не блокируется даже на долгом execute_ruby.

require 'json'

module BACommunity
  module Stultus
    module Dialog
      module_function

      def show
        if @dialog && @dialog.visible?
          @dialog.bring_to_front
          return @dialog
        end
        @dialog = build
        @dialog.show
        @dialog
      end

      def build
        dialog = UI::HtmlDialog.new(
          dialog_title:    "#{PLUGIN_NAME} — чат с ИИ",
          preferences_key: PREFS_KEY,
          scrollable:      false,
          resizable:       true,
          width:           520,
          height:          760,
          min_width:       380,
          min_height:      460,
          style:           UI::HtmlDialog::STYLE_DIALOG
        )
        dialog.set_file(File.join(PLUGIN_PATH, 'html', 'index.html'))
        # Обработчик закрытия срабатывает с опозданием: если окно закрыли и
        # тут же открыли новое, старый обработчик обнулял ссылку уже на новое.
        dialog.set_on_closed do
          log("on_closed: current=#{@dialog.equal?(dialog)} visible=#{(dialog.visible? rescue '?')}")
          if @dialog.equal?(dialog)
            @dialog = nil
            Selection.detach
          end
        end

        register(dialog, 'ready') do |_id, _payload|
          watch_selection(dialog)
          {
            settings:  Settings.all,
            history:   History.load,
            sessions:  History.sessions,
            instance:  instance_info,
            selection: Selection.summary,
            archive:   History.archive_info,
            accent:    History.accent
          }
        end

        register(dialog, 'scene_state') do |_id, p|
          watch_selection(dialog)
          Scene.snapshot(full: p.key?('full') ? p['full'] ? true : false : true)
        end

        register(dialog, 'select') do |_id, p|
          Selection.select(p['ids'], mode: (p['mode'] || 'replace').to_s, zoom: p['zoom'] ? true : false)
        end

        register(dialog, 'execute_ruby') do |_id, p|
          Runner.execute(
            p['code'],
            label:       p['label'],
            # Второй и дальше вызовы хода — прозрачные операции: один Undo на ход.
            transparent: p['transparent'] ? true : false,
            timeout:     Settings.all['ruby_timeout'].to_f
          )
        end

        register(dialog, 'scenes') do |_id, p|
          Scenes.run(p['action'], name: p['name'], description: p['description'])
        end

        register(dialog, 'save_attachment') do |_id, p|
          Attachments.save(p['name'], p['base64'])
        end

        register(dialog, 'read_attachment') do |_id, p|
          Attachments.read(p['path'])
        end

        register(dialog, 'save_accent') do |_id, p|
          History.save_accent(p['accent'])
          { accent: History.accent }
        end

        register(dialog, 'undo') { |_id, _p| Runner.undo }
        # Карточка ждёт решения человека — поднять окно над SketchUp.
        register(dialog, 'attention') do |_id, _p|
          dialog.bring_to_front
          { ok: true }
        end

        # Рендер V-Ray идёт в фоне: ответ уходит, когда рендерер сообщит
        # об окончании, а не по возврату обработчика.
        register_async(dialog, 'render_vray') do |_id, p, done|
          VRayRender.render(
            width:   (p['width'] || 1280).to_i,
            height:  (p['height'] || 720).to_i,
            preset:  (p['preset'] || 'medium').to_s,
            timeout: (p['timeout'] || 600).to_f,
            save_to: p['save_path'],
            &done
          )
        end

        register(dialog, 'screenshot') do |_id, p|
          if p['framing'] == 'viewport'
            Screenshot.capture_current(width: p['width'])
          else
            Screenshot.take(
            view_name:    p['view'],
            zoom_extents: p['zoom_extents'] ? true : false,
            width:        (p['width']  || 1280).to_i,
            height:       (p['height'] || 800).to_i
            )
          end
        end

        register(dialog, 'save_history') do |_id, p|
          { saved: History.save(p['messages']) }
        end

        register(dialog, 'cache_render') do |_id, p|
          RenderAssets.store(p['id'], p['image'], p['source'], preview: p['preview'] ? true : false)
        end
        # Полный большой кадр приходит кусками по порядку: дописываем в файл.
        register(dialog, 'render_chunk') do |_id, p|
          RenderAssets.append_chunk(p['id'], p['index'].to_i, p['total'].to_i, p['data'])
        end
        register(dialog, 'get_render') { |_id, p| RenderAssets.read(p['id']) }
        register(dialog, 'export_render') { |_id, p| RenderAssets.export_to(p['id'], p['path']) }
        register(dialog, 'save_render') { |_id, p| RenderAssets.export(p['id']) }

        register(dialog, 'save_sessions') do |_id, p|
          History.save_sessions(p['sessions'])
          { ok: true }
        end

        register(dialog, 'clear_history') do |_id, _p|
          History.clear.merge(archive: History.archive_info)
        end

        register(dialog, 'restore_history') do |_id, _p|
          History.restore.merge(archive: History.archive_info)
        end

        register(dialog, 'save_settings') do |_id, p|
          { settings: Settings.update(p['settings'] || {}) }
        end

        # Журнал из JS: ошибки страницы и отладочные записи — в stultus_dialog.log.
        register(dialog, 'log') do |_id, p|
          log("js: #{p['text'].to_s[0, 2000]}")
          { ok: true }
        end

        register(dialog, 'open_url') do |_id, p|
          UI.openURL(p['url'].to_s) if p['url'].to_s.start_with?('http')
          { ok: true }
        end

        dialog
      end

      # Как register, но обработчик отвечает сам, через done.call(result),
      # когда результат готов (рендер, ожидание события).
      def register_async(dialog, name)
        dialog.add_action_callback(name) do |_ctx, id, json|
          payload = json.to_s.empty? ? {} : JSON.parse(json)
          answered = false
          done = proc do |result|
            next if answered
            answered = true
            reply(dialog, id, result)
          end
          yield(id, payload, done)
        rescue StandardError, ScriptError => e
          reply(dialog, id, { ok: false, error: "#{e.class}: #{e.message}", backtrace: Array(e.backtrace).first(4) })
        end
      end

      # Наблюдатель выделения живёт, пока открыто окно; при смене модели
      # (другой файл в этом же окне) перевешивается.
      def watch_selection(dialog)
        model = Sketchup.active_model
        return if Selection.attached_to?(model)
        Selection.attach { push_selection(dialog) }
      end

      def push_selection(dialog)
        return unless @dialog.equal?(dialog) && dialog.visible?
        script = "window.Stultus && window.Stultus.selection(#{JSON.generate(Selection.summary)});"
        dialog.execute_script(script)
      rescue StandardError
        nil
      end

      # Обёртка над add_action_callback: разбирает JSON, зовёт обработчик,
      # ошибки превращает в ответ, а не в исключение внутри CEF (там оно
      # молча проглатывается, и JS ждёт вечно).
      def register(dialog, name)
        dialog.add_action_callback(name) do |_ctx, id, json|
          payload = json.to_s.empty? ? {} : JSON.parse(json)
          result = yield(id, payload)
          reply(dialog, id, result)
        rescue StandardError, ScriptError => e
          reply(dialog, id, { ok: false, error: "#{e.class}: #{e.message}", backtrace: Array(e.backtrace).first(4) })
        end
      end

      def reply(dialog, id, result)
        result = { ok: true }.merge(result) if result.is_a?(Hash) && !result.key?(:ok) && !result.key?('ok')
        script = "window.Stultus && window.Stultus.receive(#{JSON.generate({ id: id, result: result })});"
        dialog.execute_script(script)
      end

      def renderers
        list = []
        list << { id: 'vray', version: VRayRender.version } if VRayRender.available?
        ens = Sketchup.extensions.find { |e| e.name =~ /enscape/i && e.loaded? }
        list << { id: 'enscape', version: ens.version.to_s } if ens
        list
      end

      # Журнал окна — в %TEMP%/stultus_dialog.log; нужен, чтобы ловить
      # события CEF, которые иначе не видны (когда и почему окно «закрылось»).
      def log(line)
        File.open(File.join(ENV['TEMP'] || Dir.tmpdir, 'stultus_dialog.log'), 'a') { |f| f.puts("#{Time.now.strftime('%H:%M:%S')} #{line}") }
      rescue StandardError
        nil
      end

      def instance_info
        m = Sketchup.active_model
        {
          app:         'sketchup',
          app_version: Sketchup.version,
          plugin:      VERSION,
          pid:         Process.pid,
          model_title: m.title.to_s.empty? ? 'Untitled' : m.title,
          model_path:  m.path.to_s.empty? ? nil : m.path,
          # Имя файла для шапки окна; несохранённая модель — так и говорим.
          model_file:  m.path.to_s.empty? ? nil : File.basename(m.path),
          model_guid:  m.guid,
          # Какие рендереры доступны в этом SketchUp — gateway по ним решает,
          # выдавать ли модели инструмент render_vray и что писать в подсказку.
          renderers:   renderers
        }
      end
    end
  end
end
