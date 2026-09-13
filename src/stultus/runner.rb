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

      def execute(code, label: nil)
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

        model.start_operation(name, true)
        begin
          result = eval(code, TOPLEVEL_BINDING, '(stultus)', 1) # rubocop:disable Security/Eval
          model.commit_operation
          {
            ok:     true,
            result: truncate(safe_inspect(result)),
            output: truncate(captured.string)
          }
        rescue StandardError, ScriptError => e
          model.abort_operation
          {
            ok:        false,
            error:     "#{e.class}: #{e.message}",
            backtrace: Array(e.backtrace).first(6),
            output:    truncate(captured.string)
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
