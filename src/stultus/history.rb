# frozen_string_literal: true
#
# Переписка в файле модели.
#
# Хранится в словаре атрибутов модели под именем DICTIONARY. Правила:
#
#   * один словарь, три ключа — history (JSON-строка), sessions (JSON-строка
#     с идентификаторами сессий провайдеров), version. Чужие словари не
#     трогаем, своих сущностей в модель не добавляем;
#   * потолок HISTORY_LIMIT байт. Старые сообщения отбрасываются с начала:
#     .skp — рабочий файл, и раздувать его перепиской нельзя;
#   * картинки (снимки вьюпорта) в историю не пишутся никогда — только текст
#     и короткие сводки вызовов инструментов. Об этом заботится JS-сторона,
#     здесь — страховка по размеру;
#   * запись идёт прозрачной операцией: отдельного шага Undo «сохранена
#     переписка» пользователь видеть не должен.

require 'json'

module BACommunity
  module Stultus
    module History
      KEY_HISTORY  = 'history'
      KEY_SESSIONS = 'sessions'
      KEY_VERSION  = 'version'

      module_function

      def model
        Sketchup.active_model
      end

      # Массив сообщений (уже разобранный JSON). Пусто — [].
      def load
        raw = read(KEY_HISTORY)
        return [] if raw.nil? || raw.empty?
        parsed = JSON.parse(raw)
        parsed.is_a?(Array) ? parsed : []
      rescue JSON::ParserError
        []
      end

      # Принимает массив сообщений, ужимает под лимит, пишет в модель.
      # Возвращает, сколько сообщений реально сохранено.
      def save(messages)
        messages = Array(messages)
        json = JSON.generate(messages)
        while json.bytesize > HISTORY_LIMIT && messages.length > 1
          messages = messages.drop(1)
          json = JSON.generate(messages)
        end
        json = '[]' if json.bytesize > HISTORY_LIMIT
        write(KEY_HISTORY, json)
        messages.length
      end

      def clear
        write(KEY_HISTORY, '[]')
        write(KEY_SESSIONS, '{}')
      end

      # Идентификаторы сессий провайдеров: { 'claude' => 'uuid', 'codex' => 'thread' }.
      # Хранятся в модели, чтобы разговор продолжался после перезапуска
      # SketchUp, пока gateway помнит сессию.
      def sessions
        raw = read(KEY_SESSIONS)
        return {} if raw.nil? || raw.empty?
        parsed = JSON.parse(raw)
        parsed.is_a?(Hash) ? parsed : {}
      rescue JSON::ParserError
        {}
      end

      def save_sessions(hash)
        write(KEY_SESSIONS, JSON.generate(hash || {}))
      end

      def read(key)
        dict = model.attribute_dictionary(DICTIONARY, false)
        return nil unless dict
        value = dict[key]
        value.is_a?(String) ? value : nil
      end

      def write(key, value)
        m = model
        # Прозрачная операция: сливается с предыдущим шагом истории правок,
        # своего пункта в Undo не заводит.
        m.start_operation("#{PLUGIN_NAME}: переписка", true, false, true)
        dict = m.attribute_dictionary(DICTIONARY, true)
        dict[key] = value
        dict[KEY_VERSION] = VERSION
        m.commit_operation
        true
      rescue StandardError
        m.abort_operation rescue nil
        false
      end
    end
  end
end
