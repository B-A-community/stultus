# frozen_string_literal: true
#
# Исполнение Ruby-кода, который прислала модель.
#
# Правила:
#
#   * весь вызов — одна операция SketchUp. Ошибка посреди скрипта откатывает
#     всё, что он успел сделать (abort_operation), успех — один пункт в Undo
#     с понятным именем. Пользователь всегда может отменить ход модели одним
#     Ctrl+Z;
#   * stdout перехватывается: puts из скрипта попадает в ответ модели, а не
#     в Ruby-консоль, где его никто не увидит;
#   * SyntaxError — это ScriptError, а не StandardError. Ловим оба, иначе
#     опечатка модели уронит окно;
#   * результат обрезается до RESULT_LIMIT: inspect массива граней — мегабайты.
#
# Код исполняется на главном потоке SketchUp (это единственный поток, где
# можно трогать модель), и на время работы интерфейс приложения не отвечает.
# Таймаута нет: прервать eval на главном потоке не из чего. Об этом сказано
# в описании инструмента — модель должна дробить тяжёлые построения.

require 'stringio'
require 'timeout'

module BACommunity
  module Stultus
    module Runner
      module_function

      # Нативные плагины (V-Ray, Enscape) роняют весь SketchUp при неверном
      # вызове — это не Ruby-исключение, и rescue его не ловит (проверено:
      # чтение параметра V-Ray строковым ключом → fail-fast в ucrtbase.dll).
      # Поэтому из свободного кода к ним доступа нет: только проверенные
      # инструменты плагина.
      NATIVE_GUARD = /\b(VRay|Enscape)\b|Fiddle|dlopen/.freeze

      # Ошибка лимита времени: своя, чтобы её не перехватил rescue внутри кода модели.
      class TimeLimit < Exception; end # rubocop:disable Lint/InheritException

      # transparent: true — операция сливается с предыдущим пунктом Undo. Так
      # весь ход модели (5–10 вызовов) откатывается одним Ctrl+Z: первый вызов
      # хода создаёт пункт с именем задания, остальные прячутся в него.
      #
      # timeout (секунды, 0 = без лимита). ВНИМАНИЕ: прерывание идёт через
      # Timeout из другого потока Ruby и может сработать посреди вызова
      # SketchUp API. Модель откатывается abort_operation, но состояние
      # SketchUp после такого прерывания не гарантировано — возможны
      # нестабильность и вылеты. Лимит защищает от «поиска по всему диску»
      # и бесконечных циклов, а не от тяжёлой честной геометрии.
      def execute(code, label: nil, transparent: false, timeout: 0)
        code = code.to_s
        return { ok: false, error: 'Пустой код' } if code.strip.empty?
        if code =~ NATIVE_GUARD
          return {
            ok: false,
            error: 'Прямые вызовы V-Ray/Enscape из execute_ruby запрещены: ошибка в них роняет SketchUp целиком. ' \
                   'Для рендера используй инструмент render_vray; Enscape автоматизации не имеет.'
          }
        end

        model = Sketchup.active_model
        captured = StringIO.new
        old_stdout = $stdout
        $stdout = captured
        name = label.to_s.strip.empty? ? "#{PLUGIN_NAME}: ИИ" : "#{PLUGIN_NAME}: #{label.to_s.strip[0, 60]}"

        model.start_operation(name, true, false, transparent ? true : false)
        started = Time.now
        begin
          result = if timeout.to_f > 0
                     Timeout.timeout(timeout.to_f, TimeLimit) { eval(code, TOPLEVEL_BINDING, '(stultus)', 1) } # rubocop:disable Security/Eval
                   else
                     eval(code, TOPLEVEL_BINDING, '(stultus)', 1) # rubocop:disable Security/Eval
                   end
          model.commit_operation
          {
            ok:      true,
            result:  truncate(safe_inspect(result)),
            output:  truncate(captured.string),
            seconds: (Time.now - started).round(2)
          }
        rescue TimeLimit
          model.abort_operation
          {
            ok:      false,
            error:   "Превышен лимит времени #{timeout.to_f.round} с: код прерван, операция откачена. "                      'Не ищи по диску и не жди в циклах; тяжёлое построение раздели на части.',
            output:  truncate(captured.string),
            seconds: (Time.now - started).round(2),
            timed_out: true
          }
        rescue StandardError, ScriptError => e
          model.abort_operation
          {
            ok:        false,
            error:     "#{e.class}: #{e.message}",
            backtrace: Array(e.backtrace).first(6),
            output:    truncate(captured.string),
            seconds:   (Time.now - started).round(2)
          }
        ensure
          $stdout = old_stdout
        end
      end

      # Отмена последней операции — в том числе хода модели.
      def undo
        Sketchup.undo
        { ok: true }
      end

      def safe_inspect(value)
        value.inspect
      rescue StandardError => e
        "<inspect failed: #{e.message}>"
      end

      def truncate(text)
        text = text.to_s
        return text if text.length <= RESULT_LIMIT
        "#{text[0, RESULT_LIMIT]}\n… [обрезано: всего #{text.length} символов]"
      end
    end
  end
end
