# frozen_string_literal: true
#
# Учёт шагов модели в истории отмены SketchUp.
#
# Зачем. SketchUp не даёт прочитать стек Undo, а Sketchup.undo снимает
# верхний пункт, чей бы он ни был. Раньше инструмент undo просто звал его,
# и модель могла откатить действия пользователя: пользователь стёр дом,
# модель начала велосипед, ошиблась, нажала undo два раза — и дом вернулся.
#
# Как. Наблюдатель модели видит каждую операцию. Операции, которые прошли
# во время инструмента модели (track), записываются в журнал с номером хода.
# Любая другая операция поверх журнала его обнуляет: всё, что лежит под
# чужим пунктом, модели больше не принадлежит. Отмена разрешена, только
# если верхний пункт стека — шаг модели из текущего хода.
#
# Что показала проверка SketchUp 2026 (tests/live_undo_probe.rb):
#   — обычная операция: Start, Commit;
#   — операция без изменений: Start, Empty — в стек не попадает;
#   — прозрачная операция: те же Start, Commit, хотя своего пункта не
#     заводит. Поэтому шаги модели прозрачными не бывают, а запись переписки
#     в модель (она прозрачная) идёт через neutral и в журнал не попадает;
#   — abort_operation приходит как Start, Undo. Отличаем от настоящей отмены
#     по открытой операции: Undo без Start перед ним — это отмена.

module BACommunity
  module Stultus
    module UndoLedger
      Entry = Struct.new(:turn, :label, :step)

      class Watcher < Sketchup::ModelObserver
        def onTransactionStart(model);  UndoLedger.on_start(model);  end
        def onTransactionCommit(model); UndoLedger.on_commit(model); end
        def onTransactionEmpty(model);  UndoLedger.on_close(model);  end
        def onTransactionAbort(model);  UndoLedger.on_close(model);  end
        def onTransactionUndo(model);   UndoLedger.on_undo(model);   end
        def onTransactionRedo(model);   UndoLedger.on_redo(model);   end
      end

      # ||= — чтобы повторная загрузка файла при разработке не плодила
      # второй наблюдатель и не теряла журнал.
      @entries ||= []
      @steps   ||= Hash.new(0)
      @open    ||= false
      @neutral ||= 0
      @turn    ||= nil
      @label   ||= nil
      @model   ||= nil
      @watcher ||= nil

      module_function

      # Наблюдатель — на текущую модель; открыли другой файл — журнал с нуля.
      def attach(model = Sketchup.active_model)
        return if @watcher && @model.equal?(model)
        begin
          @model&.remove_observer(@watcher) if @watcher
        rescue StandardError
          nil
        end
        @model = model
        @watcher = Watcher.new
        model.add_observer(@watcher)
        @entries = []
        @open = false
      end

      # Инструмент модели: всё, что он зафиксирует, — шаги хода turn.
      def track(turn, label)
        attach
        @turn = turn.to_s
        @label = label.to_s
        yield
      ensure
        @turn = nil
        @label = nil
      end

      # Служебная запись (переписка в атрибутах модели): не шаг и не чужое.
      def neutral
        @neutral += 1
        yield
      ensure
        @neutral -= 1
      end

      def on_start(model)
        @open = true if model.equal?(@model)
      end

      def on_close(model)
        @open = false if model.equal?(@model)
      end

      def on_commit(model)
        return unless model.equal?(@model)
        @open = false
        return if @neutral.positive?
        if @turn
          @steps[@turn] += 1
          @entries << Entry.new(@turn, @label, @steps[@turn])
        else
          # Поверх легло чужое действие: под ним модели ничего не принадлежит.
          @entries.clear
        end
      end

      def on_undo(model)
        return unless model.equal?(@model)
        if @open
          # Это abort_operation: пункт в стек не попал, снимать нечего.
          @open = false
          return
        end
        @entries.pop
      end

      def on_redo(model)
        # Что именно вернулось — не узнать. Надёжнее забыть журнал.
        @entries.clear if model.equal?(@model)
      end

      # Сколько шагов хода turn лежит на вершине стека подряд.
      def steps_on_top(turn)
        attach
        t = turn.to_s
        @entries.reverse.take_while { |e| e.turn == t }.length
      end

      def refuse(text)
        { ok: false, error: text, undone: 0 }
      end

      # Отменить один последний шаг модели в текущем ходе.
      def undo_step(turn)
        attach
        top = @entries.last
        if top.nil? || top.turn != turn.to_s
          return refuse('Отменять нечего: сверху в истории нет твоих шагов из этого хода. ' \
                        'Действия пользователя и прошлые ходы ты не откатываешь. Если пользователь просит ' \
                        'откатить прошлый ход — скажи про кнопку «Отменить ход» под тем ответом или про Ctrl+Z.')
        end
        before = @entries.length
        Sketchup.undo
        return refuse('SketchUp не выполнил отмену. Ничего не изменилось.') if @entries.length == before
        left = steps_on_top(turn)
        { ok: true, undone: 1, text: "Отменён шаг #{top.step} «#{top.label}». В этом ходе осталось твоих шагов: #{left}." }
      end

      # Кнопка «Отменить ход»: снять все шаги хода, пока они сверху стека.
      def undo_turn(turn)
        attach
        count = steps_on_top(turn)
        if count.zero?
          return refuse('Этот ход уже не на вершине истории: после него в модели были другие действия. ' \
                        'Чтобы ничего не потерять, отмените их сначала сами (Ctrl+Z).')
        end
        done = 0
        count.times do
          before = @entries.length
          Sketchup.undo
          break if @entries.length == before
          done += 1
        end
        { ok: done.positive?, undone: done, text: "Ход отменён: шагов #{done}." }
      end

      def reset
        @entries = []
        @open = false
      end
    end
  end
end
