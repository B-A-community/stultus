# frozen_string_literal: true
#
# Сцены SketchUp (Pages) как инструмент модели: перечислить, перейти,
# сохранить текущий вид сценой, обновить. Только штатный API SketchUp.

module BACommunity
  module Stultus
    module Scenes
      module_function

      def model
        Sketchup.active_model
      end

      def list
        pages = model.pages
        current = pages.selected_page
        {
          ok: true,
          current: current && current.name,
          scenes: pages.map do |p|
            {
              name: p.name,
              current: p.equal?(current),
              use_camera: p.use_camera?,
              camera: p.camera && Scene.pt_mm(p.camera.eye)
            }
          end
        }
      end

      # action: list | activate | add | update | delete
      def run(action, name: nil, description: nil)
        case action.to_s
        when 'list' then list
        when 'activate'
          page = find(name) or return missing(name)
          model.pages.selected_page = page
          model.active_view.invalidate
          { ok: true, activated: page.name }.merge(list)
        when 'add'
          nm = name.to_s.strip
          return { ok: false, error: 'Нужно имя сцены.' } if nm.empty?
          return { ok: false, error: "Сцена «#{nm}» уже есть — используй update или другое имя." } if find(nm)
          model.start_operation("#{PLUGIN_NAME}: сцена #{nm}", true)
          page = model.pages.add(nm)
          page.description = description.to_s if description
          model.commit_operation
          { ok: true, added: page.name }.merge(list)
        when 'update'
          page = find(name) or return missing(name)
          model.start_operation("#{PLUGIN_NAME}: обновить сцену #{page.name}", true)
          page.update
          model.commit_operation
          { ok: true, updated: page.name }
        when 'delete'
          page = find(name) or return missing(name)
          model.start_operation("#{PLUGIN_NAME}: удалить сцену #{page.name}", true)
          model.pages.erase(page)
          model.commit_operation
          { ok: true, deleted: name }.merge(list)
        else
          { ok: false, error: "Неизвестное действие: #{action}. Есть list, activate, add, update, delete." }
        end
      rescue StandardError => e
        model.abort_operation rescue nil
        { ok: false, error: "#{e.class}: #{e.message}" }
      end

      def find(name)
        return nil if name.to_s.strip.empty?
        model.pages[name.to_s] || model.pages.find { |p| p.name.casecmp(name.to_s.strip).zero? }
      end

      def missing(name)
        { ok: false, error: "Сцены «#{name}» нет. Есть: #{model.pages.map(&:name).inspect}" }
      end
    end
  end
end
