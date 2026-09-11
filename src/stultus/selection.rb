# frozen_string_literal: true
#
# Выделение пользователя: живое наблюдение и краткое описание.
#
# Наблюдатель Sketchup::SelectionObserver висит на модели, пока открыто окно,
# и при каждом изменении выделения отдаёт в окно короткую строку
# («2 группы: Стена, Окно»). Пользователь видит, что именно уйдёт модели
# вместе с сообщением, до того как нажмёт «Отправить».
#
# Для экземпляров компонентов считается, сколько всего экземпляров у
# определения: если выделен один из двухсот, модели надо знать, что правка
# определения затронет все двести.

module BACommunity
  module Stultus
    module Selection
      class Observer < Sketchup::SelectionObserver
        def initialize(&on_change)
          super()
          @on_change = on_change
          @scheduled = false
        end

        def onSelectionBulkChange(_selection) = schedule
        def onSelectionCleared(_selection) = schedule
        def onSelectionAdded(_selection, _entity) = schedule
        def onSelectionRemoved(_selection, _entity) = schedule
        # SketchUp вызывает и этот, с опечаткой в имени — оставляем оба.
        def onSelectedRemoved(_selection, _entity) = schedule

        private

        # События идут пачками (пересечение рамкой — сотни вызовов); пушим
        # один раз, на следующем тике таймера.
        def schedule
          return if @scheduled
          @scheduled = true
          UI.start_timer(0.05, false) do
            @scheduled = false
            @on_change.call
          end
        end
      end

      module_function

      def attach(&on_change)
        detach
        model = Sketchup.active_model
        @observer = Observer.new(&on_change)
        @model = model
        model.selection.add_observer(@observer)
      rescue StandardError
        @observer = nil
      end

      def detach
        return unless @observer && @model
        @model.selection.remove_observer(@observer) if @model.valid?
      rescue StandardError
        nil
      ensure
        @observer = nil
        @model = nil
      end

      def attached_to?(model)
        @observer && @model.equal?(model)
      end

      # Краткое описание текущего выделения — для окна и для промпта.
      def summary
        sel = Sketchup.active_model.selection.to_a
        {
          count: sel.length,
          text:  text_for(sel),
          by_type: sel.group_by { |e| Scene.type_of(e) }.transform_values(&:length),
          definitions: definitions_for(sel)
        }
      end

      # «ничего не выделено» / «1 группа: Стена» / «3 экземпляра «Окно 1200» из 200, 2 грани»
      def text_for(entities)
        return 'ничего не выделено' if entities.empty?

        parts = []
        groups = entities.grep(Sketchup::Group)
        unless groups.empty?
          names = groups.map { |g| Scene.name_of(g) }.compact.uniq.first(3)
          s = plural(groups.length, 'группа', 'группы', 'групп')
          s += ": #{names.join(', ')}" unless names.empty?
          s += '…' if groups.length > names.length && !names.empty?
          parts << s
        end

        entities.grep(Sketchup::ComponentInstance).group_by(&:definition).each do |defn, list|
          total = defn.count_instances
          s = "#{plural(list.length, 'экземпляр', 'экземпляра', 'экземпляров')} «#{defn.name}»"
          s += " из #{total}" if total > list.length
          parts << s
        end

        faces = entities.count { |e| e.is_a?(Sketchup::Face) }
        edges = entities.count { |e| e.is_a?(Sketchup::Edge) }
        parts << plural(faces, 'грань', 'грани', 'граней') if faces.positive?
        parts << plural(edges, 'ребро', 'ребра', 'рёбер') if edges.positive?

        other = entities.reject { |e| e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance) || e.is_a?(Sketchup::Face) || e.is_a?(Sketchup::Edge) }
        parts << plural(other.length, 'объект', 'объекта', 'объектов') unless other.empty?

        parts.join(', ')
      end

      # Для каждого определения компонента среди выделенных: сколько выделено
      # и сколько всего экземпляров в модели.
      def definitions_for(entities)
        entities.grep(Sketchup::ComponentInstance).group_by(&:definition).map do |defn, list|
          { name: defn.name, selected: list.length, total: defn.count_instances }
        end
      end

      def plural(n, one, few, many)
        m10 = n % 10
        m100 = n % 100
        word = if m10 == 1 && m100 != 11 then one
               elsif (2..4).cover?(m10) && !(12..14).cover?(m100) then few
               else many
               end
        "#{n} #{word}"
      end

      # Инструмент модели: выделить объекты по id.
      # mode: 'replace' (по умолчанию) | 'add' | 'clear'; zoom: навести камеру.
      def select(ids, mode: 'replace', zoom: false)
        model = Sketchup.active_model
        sel = model.selection
        if mode == 'clear'
          sel.clear
          return { ok: true, selected: 0, text: text_for([]) }
        end

        wanted = Array(ids).map { |i| i.to_i }
        found = []
        missing = []
        wanted.each do |id|
          e = Scene.find_by_id(id)
          e ? found << e : missing << id
        end

        sel.clear unless mode == 'add'
        # Выделять можно только сущности текущего контекста редактирования:
        # чужие SketchUp молча игнорирует. Говорим об этом прямо.
        context = model.active_entities
        outside = found.reject { |e| e.parent == context.parent }
        inside = found - outside
        sel.add(inside) unless inside.empty?
        model.active_view.zoom(sel) if zoom && !sel.empty?

        result = { ok: true, selected: sel.length, text: text_for(sel.to_a) }
        result[:missing_ids] = missing unless missing.empty?
        result[:outside_context_ids] = outside.map(&:entityID) unless outside.empty?
        result
      end
    end
  end
end
